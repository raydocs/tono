import Foundation
import Darwin
import CryptoKit
import IOKit
import IOKit.pwr_mgt

struct HTTPRequest {
    let method: String
    let path: String
    let body: Data
}

func readRequest(_ fd: Int32) throws -> HTTPRequest {
    let delimiter = Data("\r\n\r\n".utf8)
    var data = Data()
    var expectedLength: Int?
    var headerRange: Range<Data.Index>?
    var buffer = [UInt8](repeating: 0, count: 2048)

    while data.count <= maximumRequestBytes {
        if let split = data.range(of: delimiter) {
            headerRange = split
            guard split.lowerBound <= maximumHeaderBytes,
                  let header = String(data: data[..<split.lowerBound], encoding: .utf8) else {
                throw HelperFailure.invalid("Invalid request headers.")
            }
            let lines = header.components(separatedBy: "\r\n")
            guard let requestLine = lines.first else {
                throw HelperFailure.invalid("Invalid request.")
            }
            var contentLength = 0
            var sawContentLength = false
            for line in lines.dropFirst() {
                let pair = line.split(separator: ":", maxSplits: 1)
                guard pair.count == 2 else { throw HelperFailure.invalid("Invalid request header.") }
                let name = pair[0].trimmingCharacters(in: .whitespaces).lowercased()
                let value = pair[1].trimmingCharacters(in: .whitespaces)
                if name == "transfer-encoding" {
                    throw HelperFailure.invalid("Transfer encoding is not accepted.")
                }
                if name == "content-length" {
                    guard !sawContentLength, let parsed = Int(value), parsed >= 0,
                          parsed <= maximumRequestBytes - split.upperBound else {
                        throw HelperFailure.invalid("Invalid content length.")
                    }
                    sawContentLength = true
                    contentLength = parsed
                }
            }
            expectedLength = split.upperBound + contentLength
            guard let total = expectedLength else {
                throw HelperFailure.invalid("Invalid request.")
            }
            if data.count >= total {
                guard data.count == total else {
                    throw HelperFailure.invalid("Unexpected bytes after request body.")
                }
                let fields = requestLine.split(separator: " ")
                guard fields.count == 3, fields[2] == "HTTP/1.1" else {
                    throw HelperFailure.invalid("Invalid request line.")
                }
                let body = Data(data[split.upperBound..<total])
                return HTTPRequest(method: String(fields[0]), path: String(fields[1]), body: body)
            }
        }

        let count = Darwin.read(fd, &buffer, buffer.count)
        if count < 0 {
            if errno == EINTR { continue }
            throw HelperFailure.invalid("Request timed out.")
        }
        guard count > 0 else { throw HelperFailure.invalid("Incomplete request.") }
        data.append(buffer, count: count)
        if headerRange == nil, data.count > maximumHeaderBytes {
            throw HelperFailure.invalid("Request headers are too large.")
        }
        if let total = expectedLength, data.count > total {
            throw HelperFailure.invalid("Unexpected bytes after request body.")
        }
    }
    throw HelperFailure.invalid("Request is too large.")
}

func jsonObject(_ data: Data) throws -> [String: Any] {
    guard !data.isEmpty,
          let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw HelperFailure.invalid("A JSON object is required.")
    }
    return value
}

func sendResponse(_ fd: Int32, status: Int, object: [String: Any]) {
    let reason: String
    switch status {
    case 200: reason = "OK"
    case 400: reason = "Bad Request"
    case 403: reason = "Forbidden"
    case 404: reason = "Not Found"
    case 409: reason = "Conflict"
    default: reason = "Internal Server Error"
    }
    let body = (try? JSONSerialization.data(withJSONObject: object)) ?? Data(#"{"ok":false,"error":"Internal error."}"#.utf8)
    var response = Data(
        "HTTP/1.1 \(status) \(reason)\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8
    )
    response.append(body)
    try? response.withUnsafeBytes {
        guard let base = $0.baseAddress else { return }
        try writeAll(fd, bytes: base, count: $0.count)
    }
}
