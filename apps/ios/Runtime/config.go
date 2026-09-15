package tonoios

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
)

// Draft contains sensitive runtime bytes. Never serialize this object to logs,
// diagnostics, UserDefaults, provider messages or an unprotected App Group file.
// Compilation proves neither freshness nor a working tunnel/Apple artifact.
type Draft struct {
	configuration string
	watermark     Watermark
	unavailable   []string
	locations     []string
}

func (d *Draft) Configuration() string      { return d.configuration }
func (d *Draft) Watermark() Watermark       { return d.watermark }
func (d *Draft) UnavailableNodes() []string { return append([]string(nil), d.unavailable...) }
func (d *Draft) Locations() []string        { return append([]string(nil), d.locations...) }

// Compile consumes complete HTTPS response bytes, not a reconstructed routing
// subset. Previous must belong to the same authenticated account/installation.
// The extension must independently enforce an online freshness lease; policy
// revisions are NOT signed expiration times. No disk or network side effects.
func Compile(catalog, policy []byte, selected string, previous *Watermark) (*Draft, error) {
	key, _ := base64.StdEncoding.DecodeString(policyKey)
	return compile(catalog, policy, selected, previous, ed25519.PublicKey(key))
}

func compile(catalog, policy []byte, selected string, previous *Watermark, key ed25519.PublicKey) (*Draft, error) {
	var oldCatalog, oldPolicy *Revision
	if previous != nil {
		oldCatalog, oldPolicy = &previous.Catalog, &previous.Policy
	}
	policyRevision, err := admitPolicy(policy, oldPolicy, key)
	if err != nil {
		return nil, err
	}
	nodes, defaultNode, catalogRevision, err := admitCatalog(catalog, oldCatalog)
	if err != nil {
		return nil, err
	}
	if selected == "" {
		selected = defaultNode
	}
	// A missing/default-unavailable node is not permission to pick another city.
	var chosen *node
	var unavailable []string
	var locations []string
	for i := range nodes {
		locations = append(locations, nodes[i].Name)
		if nodes[i].Name == selected {
			chosen = &nodes[i]
		}
	}
	if chosen == nil {
		return nil, ErrSelection
	}

	type object = map[string]any
	outbound := object{"type": "vless", "tag": "Tono-Exit", "server": chosen.Server, "server_port": chosen.Port,
		"uuid": chosen.UUID, "tls": object{"enabled": true, "server_name": chosen.ServerName,
			"utls":    object{"enabled": true, "fingerprint": "chrome"},
			"reality": object{"enabled": true, "public_key": chosen.Reality.PublicKey, "short_id": chosen.Reality.ShortID}}}
	if chosen.Flow != "" {
		outbound["flow"] = chosen.Flow
	}
	if chosen.Kind == "hysteria2" {
		pin, _ := hex.DecodeString(strings.ReplaceAll(chosen.Fingerprint, ":", ""))
		outbound = object{"type": "hysteria2", "tag": "Tono-Exit", "server": chosen.Server,
			"server_port": chosen.Port, "password": chosen.Password,
			"tls": object{"enabled": true, "engine": "go", "server_name": chosen.ServerName,
				"certificate_leaf_sha256": pin}}
	}
	config := object{
		"log": object{"disabled": true},
		"dns": object{
			"servers": []any{
				object{"type": "fakeip", "tag": "Tono-FakeIP", "inet4_range": "198.19.0.0/16"},
				object{"type": "https", "tag": "Tono-DoH", "server": "1.1.1.1", "server_port": 443,
					"path": "/dns-query", "tls": object{"enabled": true, "server_name": "1.1.1.1"}, "detour": "Tono-Exit"},
			},
			"rules": []any{
				object{"query_type": []string{"AAAA"}, "action": "predefined", "rcode": "NOERROR"},
				object{"inbound": []string{"Tono-TUN"}, "query_type": []string{"A"}, "action": "route", "server": "Tono-FakeIP"},
			}, "final": "Tono-DoH", "strategy": "ipv4_only",
		},
		// IPv6 is CAPTURED and rejected, not left outside the tunnel. The native
		// adapter must install both default routes and DNS matchDomains=[""].
		// No mixed/controller listener, host DNS fallback, cache or stack override.
		"inbounds": []any{object{"type": "tun", "tag": "Tono-TUN", "address": []string{"198.18.0.1/30", "fdfe:dcba:9876::1/126"},
			"dns_address": []string{"198.18.0.2"}, "dns_mode": "disabled", "auto_route": true, "mtu": 1280}},
		"outbounds": []any{outbound},
		"route": object{"auto_detect_interface": true, "default_domain_resolver": "Tono-DoH", "final": "Tono-Exit",
			"rules": []any{
				object{"ip_version": 6, "action": "reject"},
				object{"port": []int{53}, "action": "hijack-dns"},
				object{"network": "udp", "action": "reject"},
			}},
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		return nil, ErrCatalog
	}
	return &Draft{string(encoded), Watermark{catalogRevision, policyRevision}, unavailable, locations}, nil
}
