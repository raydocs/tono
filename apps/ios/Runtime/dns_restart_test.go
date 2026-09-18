package tonoios

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/pem"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/miekg/dns"
	"github.com/sagernet/gvisor/pkg/tcpip"
	"github.com/sagernet/gvisor/pkg/tcpip/checksum"
	"github.com/sagernet/gvisor/pkg/tcpip/header"
	"github.com/sagernet/sing-box/experimental/libbox"
)

func TestProxiedRealDNSKeepsCachedDestinationAcrossRenewalAndProcessRestart(t *testing.T) {
	// The subprocess starts with NO sing-box/FakeIP state, while the application's
	// previously cached destination survives outside the extension process.
	if raw := os.Getenv("TONO_TEST_DNS_CONFIG"); raw != "" {
		config, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			t.Fatal(err)
		}
		s, err := libbox.TonoStart(string(config))
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		if got := packetDNS(t, s, "other.example."); got != "5.6.7.8" {
			t.Fatal("other answer", got)
		}
		packetCachedTCP(t, s, "1.2.3.4")
		packetCachedTCP(t, s, "198.19.0.2") // legacy FakeIP must be rejected, never proxied
		return
	}
	queries := make(chan string, 8)
	doh := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 65536))
		var question dns.Msg
		if question.Unpack(body) != nil || len(question.Question) != 1 {
			http.Error(w, "bad dns", 400)
			return
		}
		name := question.Question[0].Name
		queries <- name
		ip := "5.6.7.8"
		if name == "account.example." {
			ip = "1.2.3.4"
		}
		answer := new(dns.Msg).SetReply(&question)
		answer.Answer = []dns.RR{&dns.A{Hdr: dns.RR_Header{Name: name, Rrtype: dns.TypeA, Class: dns.ClassINET, Ttl: 600}, A: net.ParseIP(ip)}}
		data, _ := answer.Pack()
		w.Header().Set("Content-Type", "application/dns-message")
		_, _ = w.Write(data)
	}))
	defer doh.Close()
	proxy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()
	targets := make(chan string, 8)
	// A test-only SOCKS witness: relay ONLY the local DoH server. Record and
	// refuse application connections; no public IP is ever dialed by the test.
	go func() {
		for {
			c, err := proxy.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				_ = c.SetDeadline(time.Now().Add(10 * time.Second))
				greeting := make([]byte, 2)
				if _, err := io.ReadFull(c, greeting); err != nil {
					return
				}
				if _, err := io.CopyN(io.Discard, c, int64(greeting[1])); err != nil {
					return
				}
				_, _ = c.Write([]byte{5, 0})
				h := make([]byte, 4)
				if _, err := io.ReadFull(c, h); err != nil {
					return
				}
				var host string
				switch h[3] {
				case 1:
					b := make([]byte, 4)
					if _, err := io.ReadFull(c, b); err != nil {
						return
					}
					host = net.IP(b).String()
				case 3:
					b := make([]byte, 1)
					if _, err := io.ReadFull(c, b); err != nil {
						return
					}
					b = make([]byte, int(b[0]))
					if _, err := io.ReadFull(c, b); err != nil {
						return
					}
					host = string(b)
				default:
					return
				}
				port := make([]byte, 2)
				if _, err := io.ReadFull(c, port); err != nil {
					return
				}
				target := net.JoinHostPort(host, strconv.Itoa(int(binary.BigEndian.Uint16(port))))
				if target != doh.Listener.Addr().String() {
					targets <- target
					_, _ = c.Write([]byte{5, 5, 0, 1, 0, 0, 0, 0, 0, 0})
					return
				}
				upstream, err := net.DialTimeout("tcp", target, time.Second)
				if err != nil {
					return
				}
				defer upstream.Close()
				_, _ = c.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0})
				go func() { _, _ = io.Copy(upstream, c); upstream.Close() }()
				_, _ = io.Copy(c, upstream)
			}()
		}
	}()
	policy, key := signedPolicy(emptyPolicy, 4)
	draft, err := compile(catalogFixture(fixtureYAML, `{}`, 7), policy, "Entry A", nil, key)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(draft.Configuration(), "fakeip") {
		t.Fatal("volatile FakeIP still emitted")
	}
	var config map[string]any
	_ = json.Unmarshal([]byte(draft.Configuration()), &config)
	// Keep emitted DNS/routing semantics. Replace only transport endpoints and
	// trust anchor with local witnesses; never loosen verification in production.
	dnsConfig := config["dns"].(map[string]any)
	server := dnsConfig["servers"].([]any)[0].(map[string]any)
	server["server"] = "127.0.0.1"
	server["server_port"] = doh.Listener.Addr().(*net.TCPAddr).Port
	server["tls"] = map[string]any{"enabled": true, "server_name": "127.0.0.1", "certificate": []string{string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: doh.Certificate().Raw}))}}
	config["outbounds"] = []any{map[string]any{"type": "socks", "tag": "Tono-Exit", "server": "127.0.0.1", "server_port": proxy.Addr().(*net.TCPAddr).Port, "version": "5"}}
	encoded, _ := json.Marshal(config)
	first, err := libbox.TonoStart(string(encoded))
	if err != nil {
		t.Fatal(err)
	}
	cached := packetDNS(t, first, "account.example.")
	first.Close()
	if cached != "1.2.3.4" {
		t.Fatal("not a real DNS answer", cached)
	}
	renewed, err := libbox.TonoStart(string(encoded))
	if err != nil {
		t.Fatal(err)
	}
	if packetDNS(t, renewed, "other.example.") != "5.6.7.8" {
		t.Fatal("wrong unrelated DNS answer")
	}
	packetCachedTCP(t, renewed, cached)
	packetCachedTCP(t, renewed, "198.19.0.2")
	renewed.Close()
	child := exec.Command(os.Args[0], "-test.run=^TestProxiedRealDNSKeepsCachedDestinationAcrossRenewalAndProcessRestart$", "-test.timeout=20s")
	child.Env = append(os.Environ(), "TONO_TEST_DNS_CONFIG="+base64.StdEncoding.EncodeToString(encoded))
	if output, err := child.CombinedOutput(); err != nil {
		t.Fatalf("fresh process: %v %s", err, output)
	}
	for i := 0; i < 2; i++ {
		select {
		case target := <-targets:
			if target != "1.2.3.4:80" {
				t.Fatal("cached destination rebound", target)
			}
		case <-time.After(time.Second):
			t.Fatal("cached TCP bypassed proxy")
		}
	}
	select {
	case target := <-targets:
		t.Fatal("legacy FakeIP escaped", target)
	default:
	}
	if <-queries != "account.example." || <-queries != "other.example." || <-queries != "other.example." {
		t.Fatal("wrong DNS query path")
	}
}

func packetRead(t *testing.T, s *libbox.TonoPacketSession) []byte {
	t.Helper()
	result := make(chan []byte, 1)
	go func() { p, _ := s.Read(); result <- p }()
	select {
	case p := <-result:
		if len(p) < 28 {
			t.Fatal("short response")
		}
		return p
	case <-time.After(5 * time.Second):
		s.Close()
		t.Fatal("packet response timeout")
		return nil
	}
}

func packetIPv4(destination string, protocol byte, payload []byte) []byte {
	p := make([]byte, 20+len(payload))
	p[0] = 0x45
	p[8] = 64
	p[9] = protocol
	binary.BigEndian.PutUint16(p[2:4], uint16(len(p)))
	copy(p[12:16], net.ParseIP("198.18.0.1").To4())
	copy(p[16:20], net.ParseIP(destination).To4())
	binary.BigEndian.PutUint16(p[10:12], ^checksum.Checksum(p[:20], 0))
	copy(p[20:], payload)
	if protocol == 6 {
		pseudo := header.PseudoHeaderChecksum(6, tcpip.AddrFromSlice(p[12:16]), tcpip.AddrFromSlice(p[16:20]), uint16(len(payload)))
		binary.BigEndian.PutUint16(p[36:38], ^checksum.Checksum(p[20:], pseudo))
	}
	return p
}

func packetDNS(t *testing.T, s *libbox.TonoPacketSession, name string) string {
	t.Helper()
	question := new(dns.Msg).SetQuestion(name, dns.TypeA)
	data, _ := question.Pack()
	udp := make([]byte, 8+len(data))
	binary.BigEndian.PutUint16(udp[:2], 49173)
	binary.BigEndian.PutUint16(udp[2:4], 53)
	binary.BigEndian.PutUint16(udp[4:6], uint16(len(udp)))
	copy(udp[8:], data)
	if err := s.Write(packetIPv4("198.18.0.2", 17, udp)); err != nil {
		t.Fatal(err)
	}
	p := packetRead(t, s)
	var answer dns.Msg
	if answer.Unpack(p[int(p[0]&15)*4+8:]) != nil || len(answer.Answer) != 1 {
		t.Fatal("invalid DNS answer")
	}
	a, ok := answer.Answer[0].(*dns.A)
	if !ok {
		t.Fatal("not an A answer")
	}
	return a.A.String()
}

func packetCachedTCP(t *testing.T, s *libbox.TonoPacketSession, destination string) {
	t.Helper()
	tcp := make([]byte, 20)
	binary.BigEndian.PutUint16(tcp[:2], 49231)
	binary.BigEndian.PutUint16(tcp[2:4], 80)
	binary.BigEndian.PutUint32(tcp[4:8], 100)
	tcp[12] = 0x50
	tcp[13] = 2
	binary.BigEndian.PutUint16(tcp[14:16], 65535)
	if err := s.Write(packetIPv4(destination, 6, tcp)); err != nil {
		t.Fatal(err)
	}
	p := packetRead(t, s)
	if p[9] != 6 {
		t.Fatal("expected TCP refusal/handshake")
	}
	if p[33]&4 != 0 {
		return
	}
	if p[33]&0x12 != 0x12 {
		t.Fatal("expected SYN-ACK")
	}
	tcp[13] = 0x10
	binary.BigEndian.PutUint32(tcp[4:8], 101)
	binary.BigEndian.PutUint32(tcp[8:12], binary.BigEndian.Uint32(p[24:28])+1)
	if err := s.Write(packetIPv4(destination, 6, tcp)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4; i++ {
		if packetRead(t, s)[33]&4 != 0 {
			return
		}
	}
	t.Fatal("test proxy did not refuse cached connection")
}
