// Owned synthetic SSE benchmark; it does not contact a provider API.
package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptrace"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const promptBytes = 4096

var processEpoch = time.Now()

type options struct {
	mode, directory, ca, protocol, address, serverName string
	port, concurrency, eventBytes                      int
	duration, interval, timeout, cancelAfter           time.Duration
}
type wireEvent struct {
	Index        int     `json:"index"`
	Payload      string  `json:"payload"`
	ServerEmitMS float64 `json:"server_emit_ms"`
	Active       int     `json:"active"`
}
type event struct {
	Index           int     `json:"index"`
	Bytes           int     `json:"bytes"`
	ServerEmitMS    float64 `json:"server_emit_ms"`
	ClientArrivalMS float64 `json:"client_arrival_ms"`
	Active          int     `json:"active"`
}
type sample struct {
	RequestID          string   `json:"request_id"`
	Status             string   `json:"status"`
	Error              string   `json:"error,omitempty"`
	StartMS            float64  `json:"start_ms"`
	EndMS              float64  `json:"end_ms"`
	ElapsedMS          float64  `json:"elapsed_ms"`
	RequestBodyBytes   int      `json:"request_body_bytes"`
	HTTPProto          string   `json:"http_proto,omitempty"`
	TLSALPN            string   `json:"tls_alpn,omitempty"`
	ConnectionID       string   `json:"connection_id,omitempty"`
	GotConnReused      bool     `json:"got_conn_reused"`
	TTFBMS             *float64 `json:"ttfb_ms,omitempty"`
	FirstEventMS       *float64 `json:"first_event_ms,omitempty"`
	CompletionMS       *float64 `json:"completion_ms,omitempty"`
	ResponseBodyBytes  int      `json:"response_body_bytes"`
	EventBytes         int      `json:"event_bytes"`
	Events             []event  `json:"events"`
	Done               bool     `json:"done"`
	CancelAcknowledged bool     `json:"cancel_acknowledged"`
}
type warmEvidence struct {
	RequestID     string `json:"request_id"`
	HTTPProto     string `json:"http_proto,omitempty"`
	TLSALPN       string `json:"tls_alpn,omitempty"`
	ConnectionID  string `json:"connection_id,omitempty"`
	GotConnReused bool   `json:"got_conn_reused"`
	Status        string `json:"status"`
}
type output struct {
	Status             string         `json:"status"`
	Protocol           string         `json:"protocol"`
	Concurrency        int            `json:"concurrency"`
	ExpectedEvents     int            `json:"expected_events"`
	MeasuredDurationMS float64        `json:"measured_duration_ms"`
	ElapsedMS          float64        `json:"elapsed_ms"`
	PromptBytes        int            `json:"prompt_bytes"`
	EventBytes         int            `json:"event_bytes"`
	Samples            []sample       `json:"samples"`
	Warmup             []warmEvidence `json:"warmup"`
	Counters           map[string]int `json:"counters"`
}
type requestState struct{ Cancelled, Completed bool }
type serverState struct {
	next     atomic.Uint64
	active   atomic.Int64
	mu       sync.Mutex
	requests map[string]requestState
}
type connKey struct{}

func protocols(name string) *http.Protocols {
	p := new(http.Protocols)
	p.SetHTTP1(name == "h1" || name == "both")
	p.SetHTTP2(name == "h2" || name == "both")
	return p
}
func main() {
	var o options
	flag.StringVar(&o.mode, "mode", "batch", "fixture|batch")
	flag.StringVar(&o.directory, "directory", "", "certificate directory")
	flag.StringVar(&o.ca, "ca", "", "CA PEM")
	flag.StringVar(&o.protocol, "protocol", "h2", "h1|h2")
	flag.StringVar(&o.address, "address", "203.0.113.10", "origin address")
	flag.StringVar(&o.serverName, "server-name", "hy2.test", "verified TLS name")
	flag.IntVar(&o.port, "port", 18080, "origin port")
	flag.IntVar(&o.concurrency, "concurrency", 1, "1..8")
	flag.DurationVar(&o.duration, "duration", 30*time.Second, "stream duration, max 60s")
	flag.DurationVar(&o.interval, "interval", 50*time.Millisecond, "event interval")
	flag.IntVar(&o.eventBytes, "event-bytes", 128, "payload bytes, max 512")
	flag.DurationVar(&o.timeout, "timeout", 45*time.Second, "request timeout, max 75s")
	flag.DurationVar(&o.cancelAfter, "cancel-after", 0, "explicit cancellation delay")
	flag.Parse()
	if flag.NArg() != 0 || (o.mode != "fixture" && o.mode != "batch") || (o.protocol != "h1" && o.protocol != "h2") || o.concurrency < 1 || o.concurrency > 8 || o.duration <= 0 || o.duration > 60*time.Second || o.interval <= 0 || o.duration%time.Millisecond != 0 || o.interval%time.Millisecond != 0 || o.duration/o.interval < 1 || o.duration/o.interval > 3000 || o.eventBytes < 1 || o.eventBytes > 512 || o.timeout <= 0 || o.timeout > 75*time.Second || o.cancelAfter < 0 {
		fatal(errors.New("invalid workload options"))
	}
	if o.mode == "fixture" {
		if err := serveFixture(o); err != nil {
			fatal(err)
		}
		return
	}
	pem, err := os.ReadFile(o.ca)
	if err != nil {
		fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(pem) {
		fatal(errors.New("invalid CA PEM"))
	}
	out := runBatch(o, roots)
	json.NewEncoder(os.Stdout).Encode(out)
	if out.Status == "FAIL" {
		os.Exit(1)
	}
}
func fatal(err error) {
	json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "FAIL", "error": err.Error()})
	os.Exit(2)
}
func serveFixture(o options) error {
	cert, err := tls.LoadX509KeyPair(filepath.Join(o.directory, "leaf.pem"), filepath.Join(o.directory, "leaf.key"))
	if err != nil {
		return err
	}
	st := newServerState()
	listeners := []string{"203.0.113.10:18080", "203.0.113.10:18081", "203.0.113.10:18082", "127.0.0.1:34443"}
	for _, a := range listeners {
		ln, e := net.Listen("tcp4", a)
		if e != nil {
			return e
		}
		srv := fixtureServer(st, "both")
		srv.TLSConfig = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13, MaxVersion: tls.VersionTLS13, NextProtos: []string{"h2", "http/1.1"}}
		go func() { _ = srv.ServeTLS(ln, "", "") }()
	}
	select {}
}
func newServerState() *serverState { return &serverState{requests: make(map[string]requestState)} }
func fixtureServer(st *serverState, proto string) *http.Server {
	s := &http.Server{Handler: fixtureHandler(st), Protocols: protocols(proto), ReadHeaderTimeout: 3 * time.Second, IdleTimeout: 80 * time.Second, ErrorLog: log.New(io.Discard, "", 0)}
	s.ConnContext = func(ctx context.Context, _ net.Conn) context.Context {
		return context.WithValue(ctx, connKey{}, strconv.FormatUint(st.next.Add(1), 10))
	}
	return s
}
func fixtureHandler(st *serverState) http.Handler {
	mux := http.NewServeMux()
	// Exact B2 burst shape, used only for the declared post-burst control/diagnostic.
	mux.HandleFunc("/ai/burst", func(w http.ResponseWriter, r *http.Request) {
		var q struct {
			Prompt        string `json:"prompt"`
			ResponseBytes int    `json:"response_bytes"`
		}
		if r.Method != "POST" || json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&q) != nil ||
			len(q.Prompt) < 1 || len(q.Prompt) > 128<<10 || strings.Trim(q.Prompt, "P") != "" || q.ResponseBytes < 1 || q.ResponseBytes > 512<<10 {
			http.Error(w, "invalid synthetic burst", 400)
			return
		}
		headers(w, r)
		w.Header().Set("X-Tono-Connection-ID", w.Header().Get("X-Connection-ID"))
		w.Header().Set("X-Prompt-Bytes", strconv.Itoa(len(q.Prompt)))
		body, _ := json.Marshal(map[string]string{"text": strings.Repeat("Z", q.ResponseBytes)})
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		_, _ = w.Write(body)
	})
	mux.HandleFunc("/warm", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method", 405)
			return
		}
		b, err := io.ReadAll(io.LimitReader(r.Body, 64))
		if err != nil || string(b) != "warm" {
			http.Error(w, "bad warmup", 400)
			return
		}
		time.Sleep(50 * time.Millisecond)
		headers(w, r)
		w.Write([]byte("warm"))
	})
	mux.HandleFunc("/stream", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method", 405)
			return
		}
		var q struct {
			Prompt     string `json:"prompt"`
			DurationMS int64  `json:"duration_ms"`
			IntervalMS int64  `json:"interval_ms"`
			EventBytes int    `json:"event_bytes"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&q) != nil || len(q.Prompt) != promptBytes || strings.Trim(q.Prompt, "P") != "" || q.DurationMS < 1 || q.DurationMS > 60000 || q.IntervalMS < 1 || q.EventBytes < 1 || q.EventBytes > 512 {
			http.Error(w, "invalid", 400)
			return
		}
		count := q.DurationMS / q.IntervalMS
		if count < 1 || count > 3000 {
			http.Error(w, "invalid", 400)
			return
		}
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			http.Error(w, "request id", 400)
			return
		}
		st.mu.Lock()
		if _, exists := st.requests[id]; exists || len(st.requests) >= 4096 {
			st.mu.Unlock()
			http.Error(w, "duplicate request or capacity", 409)
			return
		}
		st.requests[id] = requestState{}
		st.mu.Unlock()
		st.active.Add(1)
		defer st.active.Add(-1)
		start := time.Now()
		headers(w, r)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		for i := int64(0); i < count; i++ {
			target := time.Duration(i+1) * time.Duration(q.IntervalMS) * time.Millisecond
			timer := time.NewTimer(time.Until(start.Add(target)))
			select {
			case <-r.Context().Done():
				timer.Stop()
				st.set(id, true, false)
				return
			case <-timer.C:
			}
			e := wireEvent{int(i), strings.Repeat("Z", q.EventBytes), ms(time.Since(start)), int(st.active.Load())}
			b, _ := json.Marshal(e)
			if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
				st.set(id, true, false)
				return
			}
			w.(http.Flusher).Flush()
		}
		timer := time.NewTimer(time.Until(start.Add(time.Duration(q.DurationMS) * time.Millisecond)))
		select {
		case <-r.Context().Done():
			timer.Stop()
			st.set(id, true, false)
			return
		case <-timer.C:
		}
		if _, err := io.WriteString(w, "data: [DONE]\n\n"); err != nil {
			st.set(id, true, false)
			return
		}
		w.(http.Flusher).Flush()
		st.set(id, false, true)
	})
	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			http.Error(w, "method", 405)
			return
		}
		st.mu.Lock()
		v, ok := st.requests[r.URL.Query().Get("id")]
		st.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"found": ok, "cancelled": v.Cancelled, "completed": v.Completed, "active_streams": st.active.Load()})
	})
	return mux
}
func (s *serverState) set(id string, cancelled, completed bool) {
	s.mu.Lock()
	s.requests[id] = requestState{cancelled, completed}
	s.mu.Unlock()
}
func headers(w http.ResponseWriter, r *http.Request) {
	if id, ok := r.Context().Value(connKey{}).(string); ok {
		w.Header().Set("X-Connection-ID", id)
	}
}
func transport(o options, roots *x509.CertPool) *http.Transport {
	return &http.Transport{Protocols: protocols(o.protocol), TLSClientConfig: &tls.Config{RootCAs: roots, ServerName: o.serverName, MinVersion: tls.VersionTLS13, MaxVersion: tls.VersionTLS13, ClientSessionCache: nil, NextProtos: []string{expectedALPN(o.protocol)}}, MaxConnsPerHost: map[bool]int{true: 1, false: o.concurrency}[o.protocol == "h2"], MaxIdleConnsPerHost: o.concurrency, MaxIdleConns: o.concurrency}
}
func runBatch(o options, roots *x509.CertPool) output {
	started := time.Now()
	out := output{Status: "PASS", Protocol: o.protocol, Concurrency: o.concurrency, ExpectedEvents: int(o.duration / o.interval), MeasuredDurationMS: ms(o.duration), PromptBytes: promptBytes, EventBytes: o.eventBytes, Samples: make([]sample, o.concurrency), Counters: map[string]int{}}
	tr := transport(o, roots)
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr}
	out.Warmup = warm(client, o)
	for _, w := range out.Warmup {
		if w.Status != "PASS" {
			out.Status = "FAIL"
			out.Counters["warmup_failed"]++
		}
	}
	gate := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < o.concurrency; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); <-gate; out.Samples[i] = one(client, o, i) }(i)
	}
	close(gate)
	wg.Wait()
	for i := range out.Samples {
		s := &out.Samples[i]
		if s.Status == "PASS" && !s.GotConnReused {
			s.Status = "FAIL"
			s.Error = "SSE did not reuse a warmed connection"
		}
		if s.Status == "CANCELLED" {
			s.CancelAcknowledged = queryCancellation(client, o, s.RequestID)
			if !s.CancelAcknowledged {
				s.Status = "FAIL"
				s.Error = "server did not acknowledge cancellation"
			}
		}
		out.Counters[strings.ToLower(s.Status)]++
		out.Counters["events"] += len(s.Events)
		if s.Status == "FAIL" || s.Status == "TIMEOUT" {
			out.Status = "FAIL"
		}
		if s.Status == "CANCELLED" && o.cancelAfter == 0 {
			out.Status = "FAIL"
		}
	}
	if o.protocol == "h2" && out.Status != "FAIL" {
		id := out.Samples[0].ConnectionID
		same := id != ""
		max := 0
		for _, s := range out.Samples {
			if s.ConnectionID != id {
				same = false
			}
			for _, e := range s.Events {
				if e.Active > max {
					max = e.Active
				}
			}
		}
		if !same || max < o.concurrency {
			out.Status = "FAIL"
			out.Counters["multiplex_proof_failed"]++
		}
	}
	if o.cancelAfter > 0 && out.Status != "FAIL" {
		if out.Counters["cancelled"] == o.concurrency {
			out.Status = "CANCELLED"
		} else {
			out.Status = "FAIL"
			out.Counters["cancellation_not_observed"]++
		}
	}
	out.ElapsedMS = ms(time.Since(started))
	return out
}
func urlFor(o options, path string) string {
	return "https://" + net.JoinHostPort(o.address, strconv.Itoa(o.port)) + path
}
func traceFor(start time.Time, reused *bool, ttfb **float64) *httptrace.ClientTrace {
	return &httptrace.ClientTrace{GotConn: func(i httptrace.GotConnInfo) { *reused = i.Reused }, GotFirstResponseByte: func() { v := ms(time.Since(start)); *ttfb = &v }}
}
func warm(c *http.Client, o options) []warmEvidence {
	out := make([]warmEvidence, o.concurrency)
	gate := make(chan struct{})
	var wg sync.WaitGroup
	for i := range out {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-gate
			start := time.Now()
			ctx, cancel := context.WithTimeout(context.Background(), o.timeout)
			defer cancel()
			var reused bool
			var fb *float64
			req, _ := http.NewRequestWithContext(ctx, "POST", urlFor(o, "/warm"), strings.NewReader("warm"))
			req.GetBody = nil
			req = req.WithContext(httptrace.WithClientTrace(req.Context(), traceFor(start, &reused, &fb)))
			resp, err := c.Do(req)
			e := warmEvidence{RequestID: fmt.Sprintf("warm-%d", i), GotConnReused: reused, Status: "FAIL"}
			if err == nil {
				body, readErr := io.ReadAll(io.LimitReader(resp.Body, 64))
				resp.Body.Close()
				e.HTTPProto = resp.Proto
				e.ConnectionID = resp.Header.Get("X-Connection-ID")
				if resp.TLS != nil {
					e.TLSALPN = resp.TLS.NegotiatedProtocol
				}
				if readErr == nil && string(body) == "warm" && resp.StatusCode == 200 && e.HTTPProto == expectedProto(o.protocol) && e.TLSALPN == expectedALPN(o.protocol) && e.ConnectionID != "" {
					e.Status = "PASS"
				}
			}
			out[i] = e
		}(i)
	}
	close(gate)
	wg.Wait()
	return out
}
func expectedProto(p string) string {
	if p == "h2" {
		return "HTTP/2.0"
	}
	return "HTTP/1.1"
}
func expectedALPN(p string) string {
	if p == "h2" {
		return "h2"
	}
	return "http/1.1"
}
func one(c *http.Client, o options, index int) (s sample) {
	start := time.Now()
	s = sample{RequestID: fmt.Sprintf("req-%d-%d", time.Now().UnixNano(), index), Status: "FAIL", StartMS: ms(start.Sub(processEpoch)), EventBytes: o.eventBytes, Events: []event{}}
	defer func() { s.EndMS = ms(time.Since(processEpoch)); s.ElapsedMS = ms(time.Since(start)) }()
	ctx, cancel := context.WithTimeout(context.Background(), o.timeout)
	defer cancel()
	var explicit atomic.Bool
	if o.cancelAfter > 0 {
		go func() {
			timer := time.NewTimer(o.cancelAfter)
			defer timer.Stop()
			select {
			case <-timer.C:
				explicit.Store(true)
				cancel()
			case <-ctx.Done():
			}
		}()
	}
	body, _ := json.Marshal(map[string]any{"prompt": strings.Repeat("P", promptBytes), "duration_ms": o.duration.Milliseconds(), "interval_ms": o.interval.Milliseconds(), "event_bytes": o.eventBytes})
	s.RequestBodyBytes = len(body)
	req, _ := http.NewRequestWithContext(ctx, "POST", urlFor(o, "/stream"), bytes.NewReader(body))
	req.GetBody = nil
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", s.RequestID)
	req = req.WithContext(httptrace.WithClientTrace(req.Context(), traceFor(start, &s.GotConnReused, &s.TTFBMS)))
	resp, err := c.Do(req)
	if err != nil {
		return classify(s, err, explicit.Load())
	}
	defer resp.Body.Close()
	s.HTTPProto = resp.Proto
	s.ConnectionID = resp.Header.Get("X-Connection-ID")
	if resp.TLS != nil {
		s.TLSALPN = resp.TLS.NegotiatedProtocol
	}
	if resp.StatusCode != 200 || s.HTTPProto != expectedProto(o.protocol) || s.TLSALPN != expectedALPN(o.protocol) || s.ConnectionID == "" {
		s.Error = "HTTP/TLS/connection evidence mismatch"
		return
	}
	err = readSSE(resp.Body, start, int(o.duration/o.interval), o.eventBytes, &s)
	if err != nil {
		return classify(s, err, explicit.Load())
	}
	v := ms(time.Since(start))
	s.CompletionMS = &v
	s.Status = "PASS"
	return
}
func classify(s sample, err error, explicit bool) sample {
	s.Error = err.Error()
	if explicit && errors.Is(err, context.Canceled) {
		s.Status = "CANCELLED"
	} else if errors.Is(err, context.DeadlineExceeded) || (func() bool { var n net.Error; return errors.As(err, &n) && n.Timeout() })() {
		s.Status = "TIMEOUT"
	}
	return s
}
func readSSE(r io.Reader, start time.Time, count, size int, s *sample) error {
	scan := bufio.NewScanner(r)
	scan.Buffer(make([]byte, 1024), 1<<20)
	pending := ""
	for scan.Scan() {
		line := scan.Text()
		s.ResponseBodyBytes += len(line) + 1
		if line != "" {
			if pending != "" || !strings.HasPrefix(line, "data: ") {
				return errors.New("invalid SSE framing")
			}
			pending = strings.TrimPrefix(line, "data: ")
			continue
		}
		if pending == "" {
			continue
		}
		data := pending
		pending = ""
		if data == "[DONE]" {
			if s.Done || len(s.Events) != count {
				return errors.New("early or duplicate DONE")
			}
			s.Done = true
			continue
		}
		if s.Done {
			return errors.New("event after DONE")
		}
		var w wireEvent
		if json.Unmarshal([]byte(data), &w) != nil || w.Index != len(s.Events) || len(w.Payload) != size || strings.Trim(w.Payload, "Z") != "" {
			return errors.New("invalid SSE event/order/content")
		}
		e := event{Index: w.Index, Bytes: len(w.Payload), ServerEmitMS: w.ServerEmitMS, ClientArrivalMS: ms(time.Since(start)), Active: w.Active}
		if len(s.Events) > 0 && (e.ServerEmitMS < s.Events[len(s.Events)-1].ServerEmitMS || e.ClientArrivalMS < s.Events[len(s.Events)-1].ClientArrivalMS) {
			return errors.New("non-monotonic event offsets")
		}
		if s.FirstEventMS == nil {
			v := e.ClientArrivalMS
			s.FirstEventMS = &v
		}
		s.Events = append(s.Events, e)
	}
	if err := scan.Err(); err != nil {
		return err
	}
	if pending != "" || !s.Done || len(s.Events) != count {
		return errors.New("incomplete SSE stream")
	}
	return nil
}
func queryCancellation(c *http.Client, o options, id string) bool {
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		req, _ := http.NewRequestWithContext(ctx, "GET", urlFor(o, "/stats?id="+id), nil)
		resp, err := c.Do(req)
		if err == nil {
			var v struct{ Found, Cancelled, Completed bool }
			err = json.NewDecoder(resp.Body).Decode(&v)
			resp.Body.Close()
			cancel()
			if err == nil && v.Found && v.Cancelled && !v.Completed {
				return true
			}
		} else {
			cancel()
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}
func ms(d time.Duration) float64 { return float64(d) / float64(time.Millisecond) }
