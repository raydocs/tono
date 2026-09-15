// Package tonoios is the portable, offline-tested iOS admission/compiler layer.
// It is staged inside the pinned sing-box module by tools/check-runtime.py.
// It is NOT an approved Apple ABI and does not start a VPN.
package tonoios

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/netip"
	"reflect"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

// Errors intentionally contain no catalog, credential, destination or parser text.
var (
	ErrCatalog    = errors.New("TONO_IOS_INVALID_CATALOG")
	ErrPolicy     = errors.New("TONO_IOS_INVALID_POLICY")
	ErrCapability = errors.New("TONO_IOS_UNSUPPORTED_CAPABILITY")
	ErrPin        = errors.New("TONO_IOS_DER_BACKEND_UNAVAILABLE")
	ErrSelection  = errors.New("TONO_IOS_SELECTION_UNAVAILABLE")
)

const policyKey = "Sf2burVHXZWzYikU0FlC+N64BeRZJxJe8XaneblmTkM="
const policyContext = "tono-traffic-policy-v1\n"

type catalogEnvelope struct {
	Revision int64           `json:"revision"`
	YAML     string          `json:"yaml"`
	SHA256   string          `json:"sha256"`
	Routing  json.RawMessage `json:"routing,omitempty"`
}

type policyEnvelope struct {
	Revision  int64  `json:"revision"`
	JSON      string `json:"json"`
	SHA256    string `json:"sha256"`
	Signature string `json:"signature"`
}

// Revision receipts are scoped to the authenticated account AND installation.
// Persist them in protected storage before admitting a start, not in preferences.
type Revision struct {
	Number int64
	Digest string
}

type Watermark struct {
	Catalog Revision
	Policy  Revision
}

type node struct {
	Name              string `yaml:"name"`
	Kind              string `yaml:"type"`
	Server            string `yaml:"server"`
	Port              uint16 `yaml:"port"`
	UUID              string `yaml:"uuid"`
	Password          string `yaml:"password"`
	TLS               bool   `yaml:"tls"`
	SNI               string `yaml:"sni"`
	ServerName        string `yaml:"servername"`
	Flow              string `yaml:"flow"`
	Network           string `yaml:"network"`
	SkipVerify        bool   `yaml:"skip-cert-verify"`
	Fingerprint       string `yaml:"fingerprint"`
	ClientFingerprint string `yaml:"client-fingerprint"`
	Reality           struct {
		PublicKey string `yaml:"public-key"`
		ShortID   string `yaml:"short-id"`
	} `yaml:"reality-opts"`
}

func digest(value []byte) string {
	hash := sha256.Sum256(value)
	return base64.RawURLEncoding.EncodeToString(hash[:])
}

// Strict JSON rejects duplicate keys as well as unknown fields. Go's default
// decoder silently chooses the last duplicate, which is unsafe at an IPC boundary.
func strictJSON(data []byte, result any) error {
	if !utf8.Valid(data) {
		return ErrCatalog
	}
	// All callers decode a closed root object. Require exact JSON spellings;
	// encoding/json alone also accepts case-insensitive aliases and null ints.
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil || fields == nil {
		return ErrCatalog
	}
	typeInfo := reflect.TypeOf(result).Elem()
	allowed := map[string]bool{}
	for i := 0; i < typeInfo.NumField(); i++ {
		tag := strings.Split(typeInfo.Field(i).Tag.Get("json"), ",")
		allowed[tag[0]] = true
		value, exists := fields[tag[0]]
		if len(tag) == 1 && (!exists || string(value) == "null") {
			return ErrCatalog
		}
	}
	for name := range fields {
		if !allowed[name] {
			return ErrCatalog
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	var walk func(int) error
	walk = func(depth int) error {
		if depth > 32 {
			return ErrCatalog
		}
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		if delim, ok := token.(json.Delim); ok {
			switch delim {
			case '{':
				seen := map[string]bool{}
				for decoder.More() {
					key, err := decoder.Token()
					if err != nil {
						return err
					}
					name, ok := key.(string)
					if !ok || seen[name] {
						return ErrCatalog
					}
					seen[name] = true
					if err := walk(depth + 1); err != nil {
						return err
					}
				}
			case '[':
				for decoder.More() {
					if err := walk(depth + 1); err != nil {
						return err
					}
				}
			default:
				return ErrCatalog
			}
			_, err = decoder.Token()
		}
		return err
	}
	if err := walk(0); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return ErrCatalog
	}
	decoder = json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	return decoder.Decode(result)
}

func verifyRevision(revision int64, hash string, previous *Revision) bool {
	return revision >= 0 && (previous == nil || revision > previous.Number ||
		revision == previous.Number && hash == previous.Digest)
}

func admitPolicy(raw []byte, previous *Revision, key ed25519.PublicKey) (Revision, error) {
	var envelope policyEnvelope
	if len(raw) > 2<<20 || strictJSON(raw, &envelope) != nil || len(envelope.JSON) > 1<<20 ||
		digest([]byte(envelope.JSON)) != envelope.SHA256 ||
		!verifyRevision(envelope.Revision, envelope.SHA256, previous) {
		return Revision{}, ErrPolicy
	}
	signature, err := base64.StdEncoding.Strict().DecodeString(envelope.Signature)
	if err != nil || !ed25519.Verify(key, []byte(policyContext+envelope.JSON), signature) {
		return Revision{}, ErrPolicy
	}
	var policy struct {
		Version  int               `json:"version"`
		Domains  []json.RawMessage `json:"domains"`
		Media    []json.RawMessage `json:"mediaEndpoints"`
		TCP      []json.RawMessage `json:"tcpEndpoints,omitempty"`
		Web      []json.RawMessage `json:"webDomains,omitempty"`
		Suffixes []json.RawMessage `json:"directSuffixes,omitempty"`
	}
	if strictJSON([]byte(envelope.JSON), &policy) != nil || policy.Version < 1 || policy.Version > 3 ||
		policy.Domains == nil || policy.Media == nil {
		return Revision{}, ErrPolicy
	}
	// No desktop process lease, physical DIRECT, or implicit bypass on iOS.
	if len(policy.Domains)+len(policy.Media)+len(policy.TCP)+len(policy.Web)+len(policy.Suffixes) != 0 {
		return Revision{}, ErrCapability
	}
	return Revision{envelope.Revision, envelope.SHA256}, nil
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var hostPattern = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`)

func validHost(value string) bool {
	if len(value) == 0 || len(value) > 253 {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if !hostPattern.MatchString(label) {
			return false
		}
	}
	return true
}

func publicIPv4(value string) bool {
	address, err := netip.ParseAddr(value)
	if err != nil || !address.Is4() || !address.IsGlobalUnicast() || address.IsPrivate() {
		return false
	}
	for _, prefix := range []string{"0.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4"} {
		if netip.MustParsePrefix(prefix).Contains(address) {
			return false
		}
	}
	return true
}

func (n *node) admit() error {
	if n.Name == "" || strings.TrimSpace(n.Name) != n.Name || len(n.Name) > 128 ||
		strings.IndexFunc(n.Name, unicode.IsControl) >= 0 || strings.HasPrefix(n.Name, "Tono-") ||
		!publicIPv4(n.Server) || n.Port == 0 || n.SkipVerify {
		return ErrCatalog
	}
	switch n.Name {
	case "DIRECT", "GLOBAL", "REJECT", "REJECT-DROP":
		return ErrCatalog
	}
	if n.ServerName != "" && n.SNI != "" && n.ServerName != n.SNI {
		return ErrCatalog
	}
	if n.ServerName == "" {
		n.ServerName = n.SNI
	}
	if !validHost(n.ServerName) {
		return ErrCatalog
	}
	switch n.Kind {
	case "hysteria2":
		pin, err := hex.DecodeString(strings.ReplaceAll(n.Fingerprint, ":", ""))
		if !uuidPattern.MatchString(n.Password) || err != nil || len(pin) != 32 ||
			(n.Network != "" && n.Network != "udp") || !strings.HasSuffix(n.Name, " · hy2") {
			return ErrCatalog
		}
	case "vless":
		key, err := base64.RawURLEncoding.Strict().DecodeString(n.Reality.PublicKey)
		short, shortErr := hex.DecodeString(n.Reality.ShortID)
		if !uuidPattern.MatchString(n.UUID) || !n.TLS || err != nil || len(key) != 32 || shortErr != nil ||
			len(short) < 1 || len(short) > 8 || (n.Network != "" && n.Network != "tcp") ||
			(n.Flow != "" && n.Flow != "xtls-rprx-vision") || strings.HasSuffix(n.Name, " · hy2") {
			return ErrCatalog
		}
		// Do not silently substitute another fingerprint for an unsupported request.
		if n.ClientFingerprint != "" && n.ClientFingerprint != "chrome" {
			return ErrCapability
		}
	default:
		return ErrCapability
	}
	return nil
}

func validateYAML(n *yaml.Node, depth int) error {
	if depth > 32 || n.Kind == yaml.AliasNode || n.Anchor != "" {
		return ErrCatalog
	}
	if n.Kind == yaml.MappingNode {
		seen := map[string]bool{}
		for i := 0; i < len(n.Content); i += 2 {
			key := n.Content[i]
			if key.Kind != yaml.ScalarNode || key.Tag != "!!str" || seen[key.Value] {
				return ErrCatalog
			}
			seen[key.Value] = true
		}
	}
	for _, child := range n.Content {
		if err := validateYAML(child, depth+1); err != nil {
			return err
		}
	}
	return nil
}

func admitCatalog(raw []byte, previous *Revision) ([]node, string, Revision, error) {
	var envelope catalogEnvelope
	if len(raw) > 10<<20 || strictJSON(raw, &envelope) != nil || len(envelope.YAML) > 8<<20 ||
		digest([]byte(envelope.YAML)) != envelope.SHA256 {
		return nil, "", Revision{}, ErrCatalog
	}
	// The YAML hash does not bind routing. Include complete raw routing in the
	// local anti-equivocation receipt; do not claim this adds a server signature.
	boundHash := digest(append(append([]byte(envelope.YAML), 0), envelope.Routing...))
	if !verifyRevision(envelope.Revision, boundHash, previous) {
		return nil, "", Revision{}, ErrCatalog
	}
	var routing struct {
		Default string          `json:"defaultProxy,omitempty"`
		Home    string          `json:"homeProxy,omitempty"`
		SOCKS   json.RawMessage `json:"homeSocks5,omitempty"`
	}
	if len(envelope.Routing) != 0 && string(envelope.Routing) != "null" && strictJSON(envelope.Routing, &routing) != nil {
		return nil, "", Revision{}, ErrCatalog
	}
	// Current cloud home semantics include platform-specific process routing.
	// Neither a home endpoint nor an absent list grants ordered/fallback routing.
	if routing.Home != "" || len(routing.SOCKS) != 0 && string(routing.SOCKS) != "null" {
		return nil, "", Revision{}, ErrCapability
	}
	decoder := yaml.NewDecoder(strings.NewReader(envelope.YAML))
	var document yaml.Node
	if decoder.Decode(&document) != nil || validateYAML(&document, 0) != nil {
		return nil, "", Revision{}, ErrCatalog
	}
	var extra yaml.Node
	if decoder.Decode(&extra) != io.EOF {
		return nil, "", Revision{}, ErrCatalog
	}
	var catalog struct {
		Proxies []node `yaml:"proxies"`
	}
	if document.Decode(&catalog) != nil || len(catalog.Proxies) == 0 || len(catalog.Proxies) > 200 {
		return nil, "", Revision{}, ErrCatalog
	}
	names := map[string]node{}
	for i := range catalog.Proxies {
		n := &catalog.Proxies[i]
		if err := n.admit(); err != nil {
			return nil, "", Revision{}, err
		}
		if _, exists := names[n.Name]; exists {
			return nil, "", Revision{}, ErrCatalog
		}
		names[n.Name] = *n
	}
	for _, n := range catalog.Proxies {
		if n.Kind != "hysteria2" {
			continue
		}
		base, exists := names[strings.TrimSuffix(n.Name, " · hy2")]
		if !exists || base.Kind != "vless" || base.Server != n.Server || !strings.EqualFold(base.UUID, n.Password) {
			return nil, "", Revision{}, ErrCatalog
		}
	}
	return catalog.Proxies, routing.Default, Revision{envelope.Revision, boundHash}, nil
}
