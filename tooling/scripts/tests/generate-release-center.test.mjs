import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { assertServed, GeneratorRefusal } from '../generate-release-center.mjs'

// A local origin, because the point of these cases is what happens when the
// bucket does *not* answer the way the manifest claims, and that is not a state
// the real bucket can be asked to enter.
async function withOrigin(handler, run) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    await run(`http://127.0.0.1:${port}/artifact.zip`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const refusal = async (promise) => {
  const error = await promise.then(() => null, (caught) => caught)
  assert.ok(error instanceof GeneratorRefusal, `expected a refusal, got ${error}`)
  return error.message
}

test('accepts an object served at exactly the announced length', async () => {
  await withOrigin((_req, res) => {
    res.writeHead(200, { 'content-length': '1024' })
    res.end()
  }, async (url) => {
    await assertServed(url, 1024)
  })
})

// The fault this whole check exists for: the release and its metadata are
// intact, and the object is simply not there any more.
test('refuses an object the bucket no longer has', async () => {
  await withOrigin((_req, res) => {
    res.writeHead(404)
    res.end()
  }, async (url) => {
    const message = await refusal(assertServed(url, 1024))
    assert.match(message, /answered 404/)
    assert.match(message, /no customer can download it/)
  })
})

// Both signature schemes cover the bytes. A short object is a different file,
// so it must fail here rather than fail verification on a customer's machine.
test('refuses an object served at the wrong length', async () => {
  await withOrigin((_req, res) => {
    res.writeHead(200, { 'content-length': '512' })
    res.end()
  }, async (url) => {
    const message = await refusal(assertServed(url, 1024))
    assert.match(message, /serves 512 bytes but the release announces 1024/)
  })
})

// An answer that carries no length proves nothing about what is stored, and
// treating "no header" as agreement would restore the hole this closes.
test('refuses an answer with no content-length', async () => {
  await withOrigin((_req, res) => {
    res.writeHead(200, { 'transfer-encoding': 'chunked' })
    res.end()
  }, async (url) => {
    const message = await refusal(assertServed(url, 1024))
    assert.match(message, /served no content-length/)
  })
})

test('refuses an origin that cannot be reached at all', async () => {
  // Bound and closed, so the port is real and nothing is listening on it.
  let dead
  await withOrigin((_req, res) => res.end(), async (url) => { dead = url })
  const message = await refusal(assertServed(dead, 1024))
  assert.match(message, /could not be reached/)
})
