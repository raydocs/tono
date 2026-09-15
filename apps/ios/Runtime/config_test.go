package tonoios

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/include"
	"github.com/sagernet/sing-box/option"
	singJSON "github.com/sagernet/sing/common/json"
)

// The same registered option decoder and constructor used by the core's check
// command. This intentionally does not import libbox: that package's pinned
// oomprofile linkname is incompatible with the approved Go linker flags.
func checkConfig(config string) error {
	ctx := box.Context(context.Background(), include.InboundRegistry(), include.OutboundRegistry(),
		include.EndpointRegistry(), include.DNSTransportRegistry(), include.ServiceRegistry(), include.CertificateProviderRegistry())
	options, err := singJSON.UnmarshalExtendedContext[option.Options](ctx, []byte(config))
	if err != nil {
		return err
	}
	instance, err := box.New(box.Options{Context: ctx, Options: options})
	if err != nil {
		return err
	}
	return instance.Close()
}

const fixtureYAML = `proxies:
  - name: Entry B
    type: vless
    server: 8.8.4.4
    port: 8443
    uuid: 11111111-2222-4333-8444-555555555555
    tls: true
    servername: example.com
    network: tcp
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: "ab12"
  - name: Entry A
    type: vless
    server: 1.0.0.1
    port: 443
    uuid: 11111111-2222-4333-8444-555555555555
    tls: true
    servername: example.net
    flow: xtls-rprx-vision
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: "cd34"
  - name: Entry B · hy2
    type: hysteria2
    server: 8.8.4.4
    port: 9443
    password: 11111111-2222-4333-8444-555555555555
    sni: example.com
    fingerprint: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
dns:
  nameserver: [malicious.invalid]
rules: [MATCH,DIRECT]
`

func catalogFixture(yaml, routing string, revision int64) []byte {
	var route struct {
		Default string `json:"defaultProxy"`
	}
	_ = json.Unmarshal([]byte(routing), &route)
	encoded, _ := json.Marshal(catalogEnvelope{Revision: revision, YAML: yaml, SHA256: digest([]byte(yaml)),
		UpdatedAt: 1700000000, RoutingSHA256: digest([]byte("\n" + route.Default + "\n")), Routing: json.RawMessage(routing)})
	return encoded
}

func signedPolicy(content string, revision int64) ([]byte, ed25519.PublicKey) {
	// Test-only deterministic key. The public Compile API has no key override.
	private := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	signature := ed25519.Sign(private, []byte(policyContext+content))
	encoded, _ := json.Marshal(policyEnvelope{Revision: revision, JSON: content, SHA256: digest([]byte(content)),
		Signature: base64.StdEncoding.EncodeToString(signature), UpdatedAt: 1700000001})
	return encoded, private.Public().(ed25519.PublicKey)
}

const emptyPolicy = `{"version":3,"domains":[],"mediaEndpoints":[],"tcpEndpoints":[],"webDomains":[],"directSuffixes":[]}`

func TestEmittedRealityConfigUsesActualCoreParserAndManualSelection(t *testing.T) {
	policy, key := signedPolicy(emptyPolicy, 4)
	catalog := catalogFixture(fixtureYAML, `{"defaultProxy":"Entry B"}`, 7)
	draft, err := compile(catalog, policy, "Entry A", nil, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := checkConfig(draft.Configuration()); err != nil {
		t.Fatalf("actual core parser: %v", err)
	}
	var config map[string]any
	if err := json.Unmarshal([]byte(draft.Configuration()), &config); err != nil {
		t.Fatal(err)
	}
	outbound := config["outbounds"].([]any)[0].(map[string]any)
	if outbound["server"] != "1.0.0.1" || outbound["server_port"] != float64(443) || outbound["flow"] != "xtls-rprx-vision" {
		t.Fatal("manual pin replaced by default")
	}
	if len(draft.UnavailableNodes()) != 0 {
		t.Fatal("patched HY2 unexpectedly unavailable")
	}
	inbound := config["inbounds"].([]any)[0].(map[string]any)
	if _, exists := inbound["stack"]; exists || len(inbound["address"].([]any)) != 2 {
		t.Fatal("stack override or missing IPv6 capture")
	}
	rules := config["route"].(map[string]any)["rules"].([]any)
	if rules[0].(map[string]any)["ip_version"] != float64(6) || rules[0].(map[string]any)["action"] != "reject" ||
		rules[1].(map[string]any)["action"] != "hijack-dns" || rules[3].(map[string]any)["network"] != "udp" {
		t.Fatal("IPv6/DNS/UDP ordering")
	}
	dns := config["dns"].(map[string]any)
	if dns["servers"].([]any)[0].(map[string]any)["detour"] != "Tono-Exit" {
		t.Fatal("DNS outside proxy")
	}
	if strings.Contains(draft.Configuration(), "malicious.invalid") || strings.Contains(draft.Configuration(), "DIRECT") {
		t.Fatal("cloud runtime injection")
	}
	// A real parser negative, not just a hand-written structural assertion.
	if checkConfig(strings.Replace(draft.Configuration(), `"mtu":1280`, `"not_a_tun_option":1280`, 1)) == nil {
		t.Fatal("parser accepted unknown option")
	}
	automatic, err := compile(catalog, policy, "", nil, key)
	if err != nil || !strings.Contains(automatic.Configuration(), `"server":"8.8.4.4"`) {
		t.Fatal("explicit cloud default not used")
	}
	if _, err := compile(catalog, policy, "missing", nil, key); err != ErrSelection {
		t.Fatal("manual pin silently fell back", err)
	}
}

func TestHY2CannotLoseDERPinOrBecomeAnotherIdentity(t *testing.T) {
	policy, key := signedPolicy(emptyPolicy, 4)
	catalog := catalogFixture(fixtureYAML, `{"defaultProxy":"Entry B · hy2"}`, 7)
	draft, err := compile(catalog, policy, "", nil, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := checkConfig(draft.Configuration()); err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal([]byte(draft.Configuration()), &config); err != nil {
		t.Fatal(err)
	}
	outbound := config["outbounds"].([]any)[0].(map[string]any)
	tls := outbound["tls"].(map[string]any)
	pin, err := base64.StdEncoding.DecodeString(tls["certificate_leaf_sha256"].(string))
	if err != nil || len(pin) != 32 || pin[0] != 0xaa || tls["engine"] != "go" || tls["insecure"] != nil || tls["certificate_public_key_sha256"] != nil {
		t.Fatal("DER silently substituted")
	}
	withoutPin := strings.Replace(fixtureYAML, "    fingerprint: "+strings.Repeat("a", 64)+"\n", "", 1)
	if _, err := compile(catalogFixture(withoutPin, `{"defaultProxy":"Entry A"}`, 8), policy, "", nil, key); err != ErrCatalog {
		t.Fatal("unselected missing pin accepted", err)
	}
	differentID := strings.Replace(fixtureYAML, "password: 11111111", "password: 99999999", 1)
	if _, err := compile(catalogFixture(differentID, `{}`, 8), policy, "Entry A", nil, key); err != ErrCatalog {
		t.Fatal("HY2 second identity accepted", err)
	}
}

func TestSignedPolicyRollbackEquivocationAndUnsupportedRules(t *testing.T) {
	policy, key := signedPolicy(emptyPolicy, 4)
	catalog := catalogFixture(fixtureYAML, `{"defaultProxy":"Entry A"}`, 7)
	draft, err := compile(catalog, policy, "", nil, key)
	if err != nil {
		t.Fatal(err)
	}
	previous := draft.Watermark()
	if _, err := compile(catalog, policy, "", &previous, key); err != nil {
		t.Fatal("identical revision refused", err)
	}
	older, _ := signedPolicy(emptyPolicy, 3)
	if _, err := compile(catalog, older, "", &previous, key); err != ErrPolicy {
		t.Fatal("rollback accepted", err)
	}
	changed, _ := signedPolicy(emptyPolicy+" ", 4)
	if _, err := compile(catalog, changed, "", &previous, key); err != ErrPolicy {
		t.Fatal("same-revision equivocation", err)
	}
	newer, _ := signedPolicy(emptyPolicy, 5)
	if _, err := compile(catalog, newer, "", &previous, key); err != nil {
		t.Fatal("valid advance refused", err)
	}
	if _, err := Compile(catalog, policy, "", nil); err != ErrPolicy {
		t.Fatal("production accepted fixture signing key", err)
	}
	direct, _ := signedPolicy(strings.Replace(emptyPolicy, `"domains":[]`, `"domains":[{"host":"example.com","ports":[443]}]`, 1), 5)
	if _, err := compile(catalog, direct, "", nil, key); err != ErrCapability {
		t.Fatal("desktop DIRECT dropped", err)
	}
	unknown, _ := signedPolicy(strings.Replace(emptyPolicy, `"version":3`, `"version":3,"futureLease":true`, 1), 5)
	if _, err := compile(catalog, unknown, "", nil, key); err != ErrPolicy {
		t.Fatal("unknown signed semantics dropped", err)
	}
}

func TestRawRoutingCannotHideHomeFallbackOrEquivocation(t *testing.T) {
	policy, key := signedPolicy(emptyPolicy, 4)
	catalog := catalogFixture(fixtureYAML, `{"defaultProxy":"Entry A"}`, 7)
	draft, err := compile(catalog, policy, "", nil, key)
	if err != nil {
		t.Fatal(err)
	}
	previous := draft.Watermark()
	if _, err := compile(catalogFixture(fixtureYAML, `{"defaultProxy":"Entry B"}`, 7), policy, "", &previous, key); err != ErrCatalog {
		t.Fatal("unhashed routing replay", err)
	}
	if _, err := compile(catalogFixture(fixtureYAML, `{"defaultProxy":"Entry A","homeSocks5":{"host":"home.invalid"}}`, 8), policy, "", nil, key); err != ErrCapability {
		t.Fatal("home silently stripped", err)
	}
	if _, err := compile(catalogFixture(fixtureYAML, `{"defaultProxy":"Entry A","allowsEntryFallback":true}`, 8), policy, "", nil, key); err != ErrCatalog {
		t.Fatal("invented fallback grant", err)
	}
}

func TestAmbiguousAndUnsafeCatalogCannotReachRuntime(t *testing.T) {
	policy, key := signedPolicy(emptyPolicy, 4)
	duplicate := strings.Replace(fixtureYAML, "    port: 8443", "    port: 8443\n    port: 443", 1)
	if _, err := compile(catalogFixture(duplicate, `{}`, 7), policy, "Entry A", nil, key); err != ErrCatalog {
		t.Fatal("duplicate YAML key", err)
	}
	unsafe := strings.Replace(fixtureYAML, "    tls: true", "    tls: true\n    skip-cert-verify: true", 1)
	if _, err := compile(catalogFixture(unsafe, `{}`, 7), policy, "Entry A", nil, key); err != ErrCatalog {
		t.Fatal("unsafe unselected node", err)
	}
	private := strings.ReplaceAll(fixtureYAML, "8.8.4.4", "100.64.0.1")
	if _, err := compile(catalogFixture(private, `{}`, 7), policy, "Entry A", nil, key); err != ErrCatalog {
		t.Fatal("CGNAT endpoint", err)
	}
	catalog := catalogFixture(fixtureYAML, `{}`, 7)
	duplicateJSON := append([]byte(`{"revision":2,`), catalog[1:]...)
	if _, err := compile(duplicateJSON, policy, "Entry A", nil, key); err != ErrCatalog {
		t.Fatal("duplicate JSON key", err)
	}
	caseAlias := strings.Replace(string(catalog), `"revision":7`, `"Revision":7`, 1)
	if _, err := compile([]byte(caseAlias), policy, "Entry A", nil, key); err != ErrCatalog {
		t.Fatal("case-insensitive schema alias", err)
	}
	nullRevision := strings.Replace(string(catalog), `"revision":7`, `"revision":null`, 1)
	if _, err := compile([]byte(nullRevision), policy, "Entry A", nil, key); err != ErrCatalog {
		t.Fatal("null revision became zero", err)
	}
	alias := fixtureYAML + "extra: &ref [a,b]\nagain: *ref\n"
	if _, err := compile(catalogFixture(alias, `{}`, 7), policy, "Entry A", nil, key); err != ErrCatalog {
		t.Fatal("YAML alias accepted", err)
	}
}

func TestWorkerProducerEnvelopesReachRuntimeWithoutInventedDefault(t *testing.T) {
	data, err := os.ReadFile("worker-envelope.json")
	if err != nil {
		t.Fatal("run the actual Worker fixture producer before Go tests", err)
	}
	var fixture struct{ Catalog, Policy json.RawMessage }
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	_, key := signedPolicy(emptyPolicy, 4)
	inventory, err := discover(fixture.Catalog, fixture.Policy, nil, key)
	if err != nil {
		t.Fatal("real producer rejected", err)
	}
	if !reflect.DeepEqual(inventory.Locations(), []string{"Entry B", "Entry A", "Entry B · hy2"}) {
		t.Fatal("inventory lost nodes")
	}
	if _, err := compile(fixture.Catalog, fixture.Policy, "", nil, key); err != ErrSelection {
		t.Fatal("invented automatic authority", err)
	}
	draft, err := compile(fixture.Catalog, fixture.Policy, "Entry A", nil, key)
	if err != nil {
		t.Fatal("manual selection from no-default catalog failed", err)
	}
	if err := checkConfig(draft.Configuration()); err != nil {
		t.Fatal(err)
	}
	badTimestamp := strings.Replace(string(fixture.Policy), `"updatedAt":1700000001`, `"updatedAt":null`, 1)
	if _, err := discover(fixture.Catalog, []byte(badTimestamp), nil, key); err != ErrPolicy {
		t.Fatal("null timestamp admitted")
	}
	missingTimestamp := strings.Replace(string(fixture.Catalog), `"updatedAt":1700000000,`, "", 1)
	if _, err := discover([]byte(missingTimestamp), fixture.Policy, nil, key); err != ErrCatalog {
		t.Fatal("missing timestamp admitted")
	}
	var catalog map[string]any
	_ = json.Unmarshal(fixture.Catalog, &catalog)
	catalog["routing"] = map[string]string{"defaultProxy": "Entry B"}
	changed, _ := json.Marshal(catalog)
	if _, err := discover(changed, fixture.Policy, nil, key); err != ErrCatalog {
		t.Fatal("routing digest not checked")
	}
	catalog["routingSha256"] = digest([]byte("\nEntry B\n"))
	changed, _ = json.Marshal(catalog)
	previous := draft.Watermark()
	if _, err := discover(changed, fixture.Policy, &previous, key); err != ErrCatalog {
		t.Fatal("raw-routing equivocation not bound")
	}
	catalog["futureSecurity"] = true
	changed, _ = json.Marshal(catalog)
	if _, err := discover(changed, fixture.Policy, nil, key); err != ErrCatalog {
		t.Fatal("unknown envelope field dropped")
	}
	if _, err := Discover(fixture.Catalog, fixture.Policy, nil); err != ErrPolicy {
		t.Fatal("fixture signing key accepted by production discovery")
	}
}

func TestNodeSecurityFieldsCannotDisappear(t *testing.T) {
	policy, key := signedPolicy(emptyPolicy, 4)
	dialer := strings.Replace(fixtureYAML, "    type: vless", "    type: vless\n    dialer-proxy: Required-Home", 1)
	if _, err := compile(catalogFixture(dialer, `{}`, 7), policy, "Entry A", nil, key); err == nil {
		t.Fatal("unselected dialer-proxy dropped")
	}
	alpn := strings.Replace(fixtureYAML, "    type: hysteria2", "    type: hysteria2\n    alpn: [private-transport]", 1)
	if _, err := compile(catalogFixture(alpn, `{}`, 7), policy, "Entry A", nil, key); err == nil {
		t.Fatal("HY2 ALPN dropped")
	}
	ca := strings.Replace(fixtureYAML, "    type: vless", "    type: vless\n    ca-str: required-private-ca", 1)
	if _, err := compile(catalogFixture(ca, `{}`, 7), policy, "Entry A", nil, key); err == nil {
		t.Fatal("CA override dropped")
	}
	nested := strings.Replace(fixtureYAML, "    reality-opts:", "    reality-opts:\n      unsupported-verifier: true", 1)
	if _, err := compile(catalogFixture(nested, `{}`, 7), policy, "Entry A", nil, key); err == nil {
		t.Fatal("nested security option dropped")
	}
	metadata := strings.Replace(fixtureYAML, "    type: vless", "    type: vless\n    icon: https://example.invalid/icon.png", 1)
	draft, err := compile(catalogFixture(metadata, `{}`, 7), policy, "Entry A", nil, key)
	if err != nil || strings.Contains(draft.Configuration(), "icon.png") {
		t.Fatal("harmless icon not isolated", err)
	}
}
