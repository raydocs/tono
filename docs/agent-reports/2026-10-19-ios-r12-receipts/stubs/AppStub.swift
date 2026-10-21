// Scratch stubs: Security, Combine/SwiftUI (model layer only), UIKit bits used by AppModel.
import Foundation
let kSecClass = "class", kSecClassGenericPassword = "genp", kSecAttrService = "svce", kSecAttrAccount = "acct"
let kSecReturnData = "r_Data", kSecMatchLimit = "m_Limit", kSecMatchLimitOne = "m_LimitOne", kSecValueData = "v_Data"
let kSecAttrAccessible = "pdmn", kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly = "cku"
typealias OSStatus = Int32
typealias CFTypeRef = AnyObject
typealias CFDictionary = NSDictionary
let errSecSuccess: OSStatus = 0, errSecItemNotFound: OSStatus = -25300
let NSOSStatusErrorDomain = "NSOSStatusErrorDomain"
func SecItemCopyMatching(_ q: CFDictionary, _ r: UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus { 0 }
func SecItemUpdate(_ q: CFDictionary, _ a: CFDictionary) -> OSStatus { 0 }
func SecItemAdd(_ q: CFDictionary, _ r: UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus { 0 }
@discardableResult func SecItemDelete(_ q: CFDictionary) -> OSStatus { 0 }

protocol ObservableObject: AnyObject {}
@propertyWrapper struct Published<V> { var wrappedValue: V; init(wrappedValue: V) { self.wrappedValue = wrappedValue } }
struct Animation { static func easeInOut(duration: Double) -> Animation { Animation() } }
@MainActor func withAnimation<R>(_ a: Animation? = nil, _ body: () throws -> R) rethrows -> R { try body() }
@MainActor final class UIDevice { static let current = UIDevice(); var name = "iPhone" }
func sec_protocol_options_add_tls_application_protocol(_ o: sec_protocol_options_t, _ p: String) {}
let NSEC_PER_SEC: UInt64 = 1_000_000_000
