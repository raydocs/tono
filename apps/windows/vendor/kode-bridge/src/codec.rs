use crate::errors::{KodeBridgeError, Result};
use crate::ipc_http_server::HttpResponse;
use bytes::{BufMut as _, Bytes, BytesMut};
use http::{HeaderMap, Method, Uri};
use httparse::{Request, Status};
use std::io::Write as _;
use tokio_util::codec::{Decoder, Encoder};

/// Codec for HTTP over IPC
pub struct HttpIpcCodec {
    max_header_size: usize,
    max_request_size: usize,
}

impl HttpIpcCodec {
    pub const fn new(max_header_size: usize, max_request_size: usize) -> Self {
        Self {
            max_header_size,
            max_request_size,
        }
    }

    fn find_header_end(data: &[u8]) -> Option<usize> {
        data.windows(4).position(|window| window == b"\r\n\r\n")
    }
}

/// Parsed request parts
pub struct ParsedRequest {
    pub method: Method,
    pub uri: Uri,
    pub headers: HeaderMap,
    pub body: Bytes,
}

impl Decoder for HttpIpcCodec {
    type Item = ParsedRequest;
    type Error = KodeBridgeError;

    fn decode(&mut self, src: &mut BytesMut) -> Result<Option<Self::Item>> {
        if src.is_empty() {
            return Ok(None);
        }

        // Try to find the end of the headers
        let header_end = match Self::find_header_end(src) {
            Some(end) => end,
            None => {
                if src.len() > self.max_header_size {
                    return Err(KodeBridgeError::validation("Header size exceeds maximum allowed"));
                }
                return Ok(None);
            }
        };

        // Parse headers once so we can enforce limits without parsing the request again.
        let headers_len = header_end + 4; // Include \r\n\r\n

        let mut headers = vec![httparse::EMPTY_HEADER; 64];
        let mut req = Request::new(&mut headers);

        let status = req
            .parse(&src[..headers_len])
            .map_err(|e| KodeBridgeError::validation(format!("Failed to parse HTTP request: {}", e)))?;

        match status {
            Status::Complete(body_start) => {
                let mut content_length = 0;
                for header in req.headers.iter() {
                    if header.name.eq_ignore_ascii_case("Content-Length") {
                        if let Ok(s) = std::str::from_utf8(header.value) {
                            if let Ok(len) = s.parse::<usize>() {
                                content_length = len;
                            }
                        }
                    }
                }

                // Checked, because `content_length` is attacker-controlled and
                // `usize` addition wraps in release. A `Content-Length` chosen so
                // that `headers_len + content_length` wraps to a small number
                // walks straight past the size limit below, and `split_to` then
                // yields a buffer shorter than `body_start` — so `slice` panics
                // on an out-of-range start. The service is built with
                // `panic = "abort"`, so that panic is the whole privileged
                // process going away, taking the firewall and DNS ownership with
                // it, on one unauthenticated request.
                let total_len = match headers_len.checked_add(content_length) {
                    Some(total) => total,
                    None => {
                        return Err(KodeBridgeError::validation(
                            "Request size exceeds maximum allowed",
                        ));
                    }
                };

                if total_len > self.max_request_size {
                    return Err(KodeBridgeError::validation("Request size exceeds maximum allowed"));
                }

                if src.len() < total_len {
                    src.reserve(total_len - src.len());
                    return Ok(None);
                }

                let method = req
                    .method
                    .ok_or_else(|| KodeBridgeError::validation("Missing HTTP method"))?;
                let method = Method::from_bytes(method.as_bytes())
                    .map_err(|e| KodeBridgeError::validation(format!("Invalid HTTP method: {}", e)))?;

                let path = req
                    .path
                    .ok_or_else(|| KodeBridgeError::validation("Missing HTTP path"))?;
                let uri = path
                    .parse::<Uri>()
                    .map_err(|e| KodeBridgeError::validation(format!("Invalid URI: {}", e)))?;

                let mut header_map = HeaderMap::new();
                for header in req.headers {
                    if let (Ok(name), Ok(value)) = (
                        header.name.parse::<http::header::HeaderName>(),
                        http::header::HeaderValue::from_bytes(header.value),
                    ) {
                        header_map.insert(name, value);
                    }
                }

                // We have the full request. Split the buffer only after extracting owned metadata.
                let data = src.split_to(total_len);
                let bytes = data.freeze();
                // Belt and braces for the same class of fault: `body_start` comes
                // from the parser and `total_len` from a header, and `slice`
                // panics rather than erroring when they disagree. In a process
                // that aborts on panic, a decoder must never be the thing that
                // decides the service stops running.
                if body_start > bytes.len() {
                    return Err(KodeBridgeError::validation(
                        "Request body offset is outside the request",
                    ));
                }
                let body = bytes.slice(body_start..);

                Ok(Some(ParsedRequest {
                    method,
                    uri,
                    headers: header_map,
                    body,
                }))
            }
            Status::Partial => Ok(None),
        }
    }
}

impl Encoder<HttpResponse> for HttpIpcCodec {
    type Error = KodeBridgeError;

    fn encode(&mut self, item: HttpResponse, dst: &mut BytesMut) -> Result<()> {
        dst.reserve(256 + item.body.len());

        let status = item.status;
        let reason = status.canonical_reason().unwrap_or("Unknown");

        let mut writer = dst.writer();
        write!(writer, "HTTP/1.1 {} {}\r\n", status.as_u16(), reason)
            .map_err(|e| KodeBridgeError::connection(format!("Failed to write response status: {}", e)))?;

        let mut has_content_length = false;
        for (key, value) in item.headers.iter() {
            write!(writer, "{}: ", key.as_str())
                .map_err(|e| KodeBridgeError::connection(format!("Failed to write header key: {}", e)))?;
            writer
                .write_all(value.as_bytes())
                .map_err(|e| KodeBridgeError::connection(format!("Failed to write header value: {}", e)))?;
            writer
                .write_all(b"\r\n")
                .map_err(|e| KodeBridgeError::connection(format!("Failed to write CRLF: {}", e)))?;

            if key.as_str().eq_ignore_ascii_case("content-length") {
                has_content_length = true;
            }
        }

        if !has_content_length {
            write!(writer, "Content-Length: {}\r\n", item.body.len())
                .map_err(|e| KodeBridgeError::connection(format!("Failed to write Content-Length: {}", e)))?;
        }

        writer
            .write_all(b"\r\n")
            .map_err(|e| KodeBridgeError::connection(format!("Failed to write header end: {}", e)))?;
        writer
            .write_all(item.body.as_ref())
            .map_err(|e| KodeBridgeError::connection(format!("Failed to write body: {}", e)))?;
        writer
            .flush()
            .map_err(|e| KodeBridgeError::connection(format!("Failed to flush: {}", e)))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codec() -> HttpIpcCodec {
        HttpIpcCodec::new(8 * 1024, 64 * 1024)
    }

    /// A `Content-Length` chosen to wrap `headers_len + content_length` must be
    /// rejected, not wrapped into a small total that walks past the size limit.
    ///
    /// Before the checked add, the wrapped total made `split_to` produce a buffer
    /// shorter than the parsed body offset, and `Bytes::slice` panics on an
    /// out-of-range start. The privileged Windows service is built with
    /// `panic = "abort"`, so this was one unauthenticated request away from
    /// taking the process that owns the firewall and DNS with it.
    #[test]
    fn a_content_length_that_wraps_the_total_is_refused() {
        let mut src = BytesMut::new();
        let head = b"POST /x HTTP/1.1\r\nContent-Length: ";
        let tail = b"\r\n\r\n";
        // Enough to wrap: usize::MAX leaves no room for a single header byte.
        let value = usize::MAX.to_string();
        src.extend_from_slice(head);
        src.extend_from_slice(value.as_bytes());
        src.extend_from_slice(tail);
        // Body bytes, so a wrapped small total would have found the buffer long
        // enough and proceeded.
        src.extend_from_slice(&[b'a'; 256]);

        let err = match codec().decode(&mut src) {
            Err(err) => err,
            Ok(_) => panic!("a wrapping Content-Length must be an error, not a panic"),
        };
        assert!(
            err.to_string().contains("Request size exceeds maximum allowed"),
            "{err}"
        );
    }

    /// The ordinary oversize case keeps behaving as before.
    #[test]
    fn an_oversize_content_length_is_still_refused() {
        let mut src = BytesMut::new();
        src.extend_from_slice(b"POST /x HTTP/1.1\r\nContent-Length: 999999999\r\n\r\n");
        let err = match codec().decode(&mut src) {
            Err(err) => err,
            Ok(_) => panic!("oversize must be refused"),
        };
        assert!(
            err.to_string().contains("Request size exceeds maximum allowed"),
            "{err}"
        );
    }

    /// And a well-formed request still decodes, so the guard did not cost the
    /// ordinary path.
    #[test]
    fn a_well_formed_request_still_decodes() {
        let mut src = BytesMut::new();
        src.extend_from_slice(b"POST /clash/start HTTP/1.1\r\nContent-Length: 5\r\n\r\nhello");
        let parsed = match codec().decode(&mut src) {
            Ok(Some(parsed)) => parsed,
            other => panic!("expected a complete request, got {}", other.is_ok()),
        };
        assert_eq!(parsed.method, Method::POST);
        assert_eq!(parsed.uri.path(), "/clash/start");
        assert_eq!(&parsed.body[..], b"hello");
    }

    /// A request whose body has not arrived yet still parks rather than erroring.
    #[test]
    fn an_incomplete_body_waits_for_more_bytes() {
        let mut src = BytesMut::new();
        src.extend_from_slice(b"POST /x HTTP/1.1\r\nContent-Length: 10\r\n\r\nabc");
        assert!(
            matches!(codec().decode(&mut src), Ok(None)),
            "a partial body must wait, not error"
        );
    }
}
