import Foundation

/// Pure Unicode flag emoji converter using Regional Indicator Symbols.
public enum UnicodeCountryFlag {
    /// Converts a 2-letter ISO country code (e.g. 'US', 'HK', 'JP', 'SG', 'DE', 'GB')
    /// to flag emoji via Unicode scalar transformation (`127397 + scalar.value`).
    ///
    /// Safely returns `nil` for invalid codes, wrong length, or non-ASCII letters.
    public static func emoji(for countryCode: String?) -> String? {
        guard let countryCode = countryCode else { return nil }
        let trimmed = countryCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count == 2 else { return nil }

        let uppercased = trimmed.uppercased()
        var flagScalars = [UnicodeScalar]()
        for scalar in uppercased.unicodeScalars {
            // Regional indicator symbols are mapped from ASCII uppercase 'A' (65) through 'Z' (90).
            guard scalar.isASCII && scalar.value >= 65 && scalar.value <= 90 else {
                return nil
            }
            // Regional Indicator Symbol Letter A is U+1F1E6 (127462 = 127397 + 65)
            guard let flagScalar = UnicodeScalar(127397 + scalar.value) else {
                return nil
            }
            flagScalars.append(flagScalar)
        }

        guard flagScalars.count == 2 else { return nil }
        return String(String.UnicodeScalarView(flagScalars))
    }
}
