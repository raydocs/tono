import Foundation

// The parser under test, compiled from the real source below.
@main
struct JWTExpiryTests {
    static func b64url(_ json: String) -> String {
        Data(json.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
    static func main() {
        var failures = 0
        func check(_ name: String, _ ok: Bool, _ detail: String = "") {
            print(ok ? "  ok   \(name)" : "  FAIL \(name) \(detail)")
            if !ok { failures += 1 }
        }
        let exp = 1_786_500_000.0
        // Real shape: the Worker signs {sub,sid,did,iid,iat,exp}.
        let token = "eyJhbGciOiJIUzI1NiJ9." + b64url(
            "{\"sub\":\"u\",\"sid\":\"s\",\"did\":\"d\",\"iid\":\"i\",\"iat\":1786499100,\"exp\":\(Int(exp))}"
        ) + ".sig"
        check("reads exp from a real-shaped token",
              TonoJWT.expiry(ofJWT: token)?.timeIntervalSince1970 == exp,
              "got \(String(describing: TonoJWT.expiry(ofJWT: token)))")
        // Padding: base64url drops "=", and a strict decoder needs it back. A
        // payload length that is not a multiple of four is the case that fails
        // if the padding is not restored.
        var paddedOK = true
        for filler in 1...8 {
            let payload = "{\"exp\":\(Int(exp)),\"pad\":\"\(String(repeating: "x", count: filler))\"}"
            let t = "h." + b64url(payload) + ".s"
            if TonoJWT.expiry(ofJWT: t)?.timeIntervalSince1970 != exp { paddedOK = false }
        }
        check("restores base64url padding at every length", paddedOK)
        check("nil for a non-JWT", TonoJWT.expiry(ofJWT: "not-a-token") == nil)
        check("nil for two segments", TonoJWT.expiry(ofJWT: "a.b") == nil)
        check("nil when exp is missing",
              TonoJWT.expiry(ofJWT: "h." + b64url("{\"sub\":\"u\"}") + ".s") == nil)
        check("nil when exp is a string",
              TonoJWT.expiry(ofJWT: "h." + b64url("{\"exp\":\"soon\"}") + ".s") == nil)
        check("nil for undecodable base64", TonoJWT.expiry(ofJWT: "h.!!!!.s") == nil)
        check("nil for a non-finite exp",
              TonoJWT.expiry(ofJWT: "h." + b64url("{\"exp\":0}") + ".s") == nil)
        print(failures == 0 ? "\nall JWT expiry checks passed" : "\n\(failures) FAILED")
        exit(failures == 0 ? 0 : 1)
    }
}
