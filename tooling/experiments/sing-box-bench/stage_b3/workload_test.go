package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
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

func testOrigin(t *testing.T, proto string, h http.Handler) (options, *x509.CertPool) {
	t.Helper()
	s := httptest.NewUnstartedServer(h)
	s.Config.ErrorLog = log.New(io.Discard, "", 0)
	s.Config.Protocols = protocols(proto)
	s.EnableHTTP2 = proto == "h2"
	var ids atomic.Uint64
	s.Config.ConnContext = func(ctx context.Context, _ net.Conn) context.Context {
		return context.WithValue(ctx, connKey{}, strconv.FormatUint(ids.Add(1), 10))
	}
	s.TLS = &tls.Config{MinVersion: tls.VersionTLS13, MaxVersion: tls.VersionTLS13, NextProtos: []string{expectedALPN(proto)}}
	s.StartTLS()
	t.Cleanup(s.Close)
	host, ps, _ := net.SplitHostPort(s.Listener.Addr().String())
	port, _ := strconv.Atoi(ps)
	roots := x509.NewCertPool()
	roots.AddCert(s.Certificate())
	return options{protocol: proto, address: host, serverName: "example.com", port: port, concurrency: 1, duration: 120 * time.Millisecond, interval: 30 * time.Millisecond, eventBytes: 32, timeout: time.Second}, roots
}
func TestHTTP1TLSAndReusableConnections(t *testing.T) {
	o, roots := testOrigin(t, "h1", fixtureHandler(newServerState()))
	o.concurrency = 3
	out := runBatch(o, roots)
	if out.Status != "PASS" || len(out.Samples) != 3 {
		t.Fatalf("bad output: %+v", out)
	}
	seen := map[string]bool{}
	for _, s := range out.Samples {
		if s.HTTPProto != "HTTP/1.1" || s.TLSALPN != "http/1.1" || !s.GotConnReused || !s.Done || len(s.Events) != 4 {
			t.Fatalf("bad h1 evidence: %+v", s)
		}
		seen[s.ConnectionID] = true
	}
	if len(seen) != 3 {
		t.Fatalf("parallel h1 did not use three warmed connections: %+v", out.Samples)
	}
}
func TestHTTP2MultiplexesOneConnection(t *testing.T) {
	o, roots := testOrigin(t, "h2", fixtureHandler(newServerState()))
	o.concurrency = 3
	out := runBatch(o, roots)
	if out.Status != "PASS" {
		t.Fatalf("bad output: %+v", out)
	}
	id := out.Samples[0].ConnectionID
	max := 0
	for _, s := range out.Samples {
		if s.HTTPProto != "HTTP/2.0" || s.TLSALPN != "h2" || !s.GotConnReused || s.ConnectionID != id {
			t.Fatalf("not multiplexed: %+v", s)
		}
		for _, e := range s.Events {
			if e.Active > max {
				max = e.Active
			}
		}
	}
	if max != 3 {
		t.Fatalf("active stream proof=%d", max)
	}
}
func TestValidationFailuresCannotPass(t *testing.T) {
	o, roots := testOrigin(t, "h1", fixtureHandler(newServerState()))
	bad := runBatch(o, x509.NewCertPool())
	if bad.Status != "FAIL" {
		t.Fatal("wrong CA passed")
	}
	wrong := o
	wrong.serverName = "wrong.test"
	if runBatch(wrong, roots).Status != "FAIL" {
		t.Fatal("wrong SNI passed")
	}
	slow, slowRoots := testOrigin(t, "h1", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(200 * time.Millisecond) }))
	slow.timeout = 30 * time.Millisecond
	timed := runBatch(slow, slowRoots)
	if timed.Status != "FAIL" || timed.Samples[0].Status != "TIMEOUT" {
		t.Fatal("timeout passed")
	}
	var s sample
	s.Events = []event{}
	truncated := "data: {\"index\":0,\"payload\":\"ZZ\",\"server_emit_ms\":1,\"active\":1}\n\n"
	if readSSE(strings.NewReader(truncated), time.Now(), 1, 2, &s) == nil {
		t.Fatal("missing DONE passed")
	}
	s = sample{Events: []event{}}
	reordered := fmt.Sprintf("data: {\"index\":1,\"payload\":\"ZZ\",\"server_emit_ms\":1,\"active\":1}\n\n")
	if readSSE(strings.NewReader(reordered), time.Now(), 1, 2, &s) == nil {
		t.Fatal("reordered event passed")
	}
}
func TestExplicitCancellationRequiresServerAcknowledgement(t *testing.T) {
	o, roots := testOrigin(t, "h2", fixtureHandler(newServerState()))
	o.concurrency = 2
	o.duration = 500 * time.Millisecond
	o.interval = 50 * time.Millisecond
	o.cancelAfter = 120 * time.Millisecond
	out := runBatch(o, roots)
	if out.Status != "CANCELLED" {
		t.Fatalf("not cancelled: %+v", out)
	}
	for _, s := range out.Samples {
		if s.Status != "CANCELLED" || !s.CancelAcknowledged || s.Done {
			t.Fatalf("false cancellation success: %+v", s)
		}
	}
	o.duration = 120 * time.Millisecond
	o.interval = 30 * time.Millisecond
	o.cancelAfter = 400 * time.Millisecond
	late := runBatch(o, roots)
	if late.Status != "FAIL" || late.Counters["cancellation_not_observed"] != 1 {
		t.Fatal("completed requests cannot prove cancellation")
	}
}
