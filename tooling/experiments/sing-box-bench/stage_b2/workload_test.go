package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func origin(t *testing.T, handler http.Handler) (options, *x509.CertPool) {
	t.Helper()
	s := httptest.NewUnstartedServer(handler)
	s.Config.ErrorLog = log.New(io.Discard, "", 0)
	var id atomic.Uint64
	s.Config.ConnContext = func(ctx context.Context, _ net.Conn) context.Context {
		return context.WithValue(ctx, connIDKey{}, strconv.FormatUint(id.Add(1), 10))
	}
	s.TLS = &tls.Config{MinVersion: tls.VersionTLS13, MaxVersion: tls.VersionTLS13}
	s.StartTLS()
	t.Cleanup(s.Close)
	host, port, _ := net.SplitHostPort(s.Listener.Addr().String())
	p, _ := strconv.Atoi(port)
	roots := x509.NewCertPool()
	roots.AddCert(s.Certificate())
	return options{address: host, port: p, serverName: "example.com", path: "/ai/burst", timeout: time.Second,
		promptBytes: 4096, responseBytes: 4096, count: 1, concurrency: 1, reuse: true}, roots
}

func TestTLSStatusTimeoutAndPayloadCannotFalsePass(t *testing.T) {
	o, roots := origin(t, fixtureHandler())
	c := &requestClient{o: o, roots: roots}
	defer c.close()
	good := c.one()
	if good.Status != "PASS" || good.ResponseBytes != 4096 || good.ConnectionID == "" {
		t.Fatalf("invalid good sample: %+v", good)
	}
	if good.ApplicationTCPMS == nil || good.OriginTLSMS == nil || good.ApplicationTCPMS == good.OriginTLSMS {
		t.Fatal("TCP/TLS observations alias or are missing")
	}
	bad := &requestClient{o: o, roots: x509.NewCertPool()}
	if got := bad.one(); got.Status != "FAIL" {
		t.Fatalf("wrong CA passed: %+v", got)
	}
	wrong := o
	wrong.serverName = "wrong.test"
	if got := (&requestClient{o: wrong, roots: roots}).one(); got.Status != "FAIL" {
		t.Fatalf("wrong SNI passed: %+v", got)
	}
	c.o.path = "/ai/failure"
	if got := c.one(); got.Status != "FAIL" {
		t.Fatalf("503 passed: %+v", got)
	}
	c.o.path = "/ai/corrupt"
	if got := c.one(); got.Status != "FAIL" {
		t.Fatalf("corrupt reply passed: %+v", got)
	}
	c.o.path, c.o.timeout = "/ai/slow", 30*time.Millisecond
	if got := c.one(); got.Status != "TIMEOUT" {
		t.Fatalf("deadline passed: %+v", got)
	}
}

func TestBatchRetainsFailuresAndProvesReuse(t *testing.T) {
	o, roots := origin(t, fixtureHandler())
	o.count = 3
	out := batch(o, roots)
	if out.Status != "PASS" || len(out.Samples) != 3 || out.Samples[0].Reused {
		t.Fatal(out)
	}
	for _, s := range out.Samples[1:] {
		if !s.Reused || s.ConnectionID != out.Samples[0].ConnectionID || s.OriginTLSMS != nil {
			t.Fatalf("unproven reuse: %+v", s)
		}
	}
	o.reuse = false
	out = batch(o, roots)
	for i, s := range out.Samples {
		if s.Reused || (i > 0 && s.ConnectionID == out.Samples[i-1].ConnectionID) {
			t.Fatal("cold request reused")
		}
	}
	o.path, o.concurrency = "/ai/failure", 2
	out = batch(o, roots)
	if len(out.Samples) != 3 || out.Status != "FAIL" {
		t.Fatal("failed samples lost")
	}
	for _, s := range out.Samples {
		if s.Status != "FAIL" {
			t.Fatal(s)
		}
	}
}

func TestStreamRequiresOrderedEventsAndCompletion(t *testing.T) {
	o, roots := origin(t, fixtureHandler())
	o.path = "/ai/stream"
	o.responseBytes = 65536
	c := &requestClient{o: o, roots: roots}
	defer c.close()
	s := c.one()
	if s.Status != "PASS" || len(s.Events) != 16 || !s.Done || s.FirstEventMS == nil || s.TTFBMS == nil || *s.FirstEventMS-*s.TTFBMS < 30 {
		t.Fatalf("bad stream: %+v", s)
	}
	c.o.path = "/ai/truncated-stream"
	s = c.one()
	if s.Status != "FAIL" || s.Done || s.ResponseBytes != 65536 {
		t.Fatalf("missing DONE became success: %+v", s)
	}
	var partial sample
	if err := readEvents(strings.NewReader(`data: {"index":0,"text":"Z","server_emit_ms":1}`), time.Now(), 16, &partial); err == nil || partial.FirstEventMS != nil {
		t.Fatal("unterminated SSE frame must not be a valid event")
	}
	if err := readEvents(strings.NewReader("data: {\"index\":1,\"text\":\"Z\",\"server_emit_ms\":1}\n\n"), time.Now(), 16, &partial); err == nil || partial.FirstEventMS != nil {
		t.Fatal("out-of-order SSE event must fail")
	}
}

func TestFirstByteDoesNotWaitForAllHeaders(t *testing.T) {
	o, roots := origin(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		conn, rw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = rw.WriteString("HTTP/1.1 200 OK\r\n")
		_ = rw.Flush()
		time.Sleep(150 * time.Millisecond)
		body, _ := json.Marshal(map[string]string{"text": strings.Repeat("Z", 4096)})
		_, _ = fmt.Fprintf(rw, "Content-Length: %d\r\nX-Prompt-Bytes: 4096\r\nConnection: close\r\n\r\n%s", len(body), body)
		_ = rw.Flush()
	}))
	c := &requestClient{o: o, roots: roots}
	defer c.close()
	s := c.one()
	if s.Status != "PASS" || s.TTFBMS == nil || *s.TTFBMS > 100 || s.ElapsedMS < 140 {
		t.Fatalf("header completion mislabeled: %+v", s)
	}
}
