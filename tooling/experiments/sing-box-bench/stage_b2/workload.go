// Owned synthetic AI API workload, not a provider API or native Tono client.
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
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var epoch = time.Now()

const maxResponse = 512 << 10

type options struct {
	mode, directory, address, serverName, ca, path       string
	port, count, concurrency, promptBytes, responseBytes int
	timeout                                              time.Duration
	reuse                                                bool
}

type event struct {
	Index           int     `json:"index"`
	Text            string  `json:"text,omitempty"`
	ServerEmitMS    float64 `json:"server_emit_ms"`
	ClientArrivalMS float64 `json:"client_arrival_ms"`
}

type sample struct {
	Status            string   `json:"status"`
	Error             string   `json:"error,omitempty"`
	PromptBytes       int      `json:"prompt_bytes"`
	RequestBodyBytes  int      `json:"request_body_bytes"`
	ResponseBytes     int      `json:"response_bytes"`
	ResponseBodyBytes int      `json:"response_body_bytes"`
	ElapsedMS         float64  `json:"elapsed_ms"`
	TTFBMS            *float64 `json:"ttfb_ms"`
	FirstEventMS      *float64 `json:"first_event_ms"`
	ApplicationTCPMS  *float64 `json:"application_tcp_ms"`
	OriginTLSMS       *float64 `json:"origin_tls_ms"`
	StartMS           float64  `json:"start_ms"`
	EndMS             float64  `json:"end_ms"`
	ConnectionID      string   `json:"connection_id,omitempty"`
	Reused            bool     `json:"reused"`
	Events            []event  `json:"events,omitempty"`
	Done              bool     `json:"done"`
}

type output struct {
	Status    string   `json:"status"`
	Samples   []sample `json:"samples"`
	ElapsedMS float64  `json:"elapsed_ms"`
}

type aiRequest struct {
	Prompt        string `json:"prompt"`
	ResponseBytes int    `json:"response_bytes"`
}

func main() {
	var o options
	flag.StringVar(&o.mode, "mode", "request", "fixture, request, batch")
	flag.StringVar(&o.directory, "directory", "", "owned fixture certificates")
	flag.StringVar(&o.address, "address", "203.0.113.10", "literal origin address")
	flag.StringVar(&o.serverName, "server-name", "hy2.test", "verified origin SNI")
	flag.StringVar(&o.ca, "ca", "", "owned CA PEM")
	flag.StringVar(&o.path, "path", "/ai/burst", "owned endpoint")
	flag.IntVar(&o.port, "port", 18080, "18080 Reality; 18081 Hy2")
	flag.IntVar(&o.count, "count", 1, "requests, max64")
	flag.IntVar(&o.concurrency, "concurrency", 1, "application concurrency, max16")
	flag.IntVar(&o.promptBytes, "prompt-bytes", 4096, "synthetic prompt size")
	flag.IntVar(&o.responseBytes, "response-bytes", 4096, "synthetic reply text size")
	flag.DurationVar(&o.timeout, "timeout", 3*time.Second, "whole request deadline, max3s")
	flag.BoolVar(&o.reuse, "reuse", true, "reuse TLS connection per worker")
	flag.Parse()
	if flag.NArg() != 0 {
		fatalJSON(errors.New("unexpected positional arguments"))
	}
	if o.mode == "fixture" {
		if err := fixture(o.directory); err != nil {
			fatalJSON(err)
		}
		return
	}
	if (o.mode != "request" && o.mode != "batch") || o.count < 1 || o.count > 64 ||
		o.concurrency < 1 || o.concurrency > 16 || o.promptBytes < 1 || o.promptBytes > 128<<10 ||
		o.responseBytes < 16 || o.responseBytes > maxResponse || o.responseBytes%16 != 0 ||
		o.timeout <= 0 || o.timeout > 3*time.Second {
		fatalJSON(errors.New("workload bounds rejected"))
	}
	if o.mode == "request" {
		o.count, o.concurrency = 1, 1
	}
	ca, err := os.ReadFile(o.ca)
	if err != nil {
		fatalJSON(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(ca) {
		fatalJSON(errors.New("invalid CA"))
	}
	out := batch(o, roots)
	if o.mode == "request" {
		out.Status = out.Samples[0].Status
	}
	_ = json.NewEncoder(os.Stdout).Encode(out)
	if out.Status != "PASS" {
		os.Exit(1)
	}
}

type connIDKey struct{}

func fixture(dir string) error {
	cert, err := tls.LoadX509KeyPair(filepath.Join(dir, "leaf.pem"), filepath.Join(dir, "leaf.key"))
	if err != nil {
		return err
	}
	var ids atomic.Uint64
	for _, address := range []string{"203.0.113.10:18080", "203.0.113.10:18081", "203.0.113.10:18082", "127.0.0.1:34443"} {
		ln, err := net.Listen("tcp4", address)
		if err != nil {
			return err
		}
		srv := &http.Server{Handler: fixtureHandler(), ReadHeaderTimeout: 3 * time.Second,
			ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second,
			ErrorLog: log.New(io.Discard, "", 0), ConnContext: func(ctx context.Context, _ net.Conn) context.Context {
				return context.WithValue(ctx, connIDKey{}, strconv.FormatUint(ids.Add(1), 10))
			}}
		conf := &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13,
			MaxVersion: tls.VersionTLS13, NextProtos: []string{"http/1.1"}}
		go func() { _ = srv.Serve(tls.NewListener(ln, conf)) }()
	}
	select {}
}

func fixtureHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		var input aiRequest
		if r.Method != "POST" || json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&input) != nil ||
			len(input.Prompt) < 1 || len(input.Prompt) > 128<<10 || strings.Trim(input.Prompt, "P") != "" ||
			input.ResponseBytes < 16 || input.ResponseBytes > maxResponse || input.ResponseBytes%16 != 0 {
			http.Error(w, "invalid synthetic request", 400)
			return
		}
		if id, ok := r.Context().Value(connIDKey{}).(string); ok {
			w.Header().Set("X-Tono-Connection-ID", id)
		}
		w.Header().Set("X-Prompt-Bytes", strconv.Itoa(len(input.Prompt)))
		switch r.URL.Path {
		case "/ai/failure":
			http.Error(w, "synthetic unavailable", 503)
			return
		case "/ai/slow":
			time.Sleep(400 * time.Millisecond)
		case "/ai/stream", "/ai/truncated-stream":
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(200)
			w.(http.Flusher).Flush()
			time.Sleep(40 * time.Millisecond) // Explicit synthetic generation delay, not proxy latency.
			for i := 0; i < 16; i++ {
				if r.Context().Err() != nil {
					return
				}
				e := event{Index: i, Text: strings.Repeat("Z", input.ResponseBytes/16), ServerEmitMS: ms(time.Since(start))}
				b, _ := json.Marshal(e)
				if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
					return
				}
				w.(http.Flusher).Flush()
				if i < 15 {
					time.Sleep(20 * time.Millisecond)
				}
			}
			if r.URL.Path == "/ai/stream" {
				_, _ = io.WriteString(w, "data: [DONE]\n\n")
			}
			return
		case "/ai/burst", "/ai/corrupt":
		default:
			http.Error(w, "not found", 404)
			return
		}
		text := strings.Repeat("Z", input.ResponseBytes)
		if r.URL.Path == "/ai/corrupt" {
			text = "X" + text[1:]
		}
		b, _ := json.Marshal(map[string]string{"text": text})
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Length", strconv.Itoa(len(b)))
		_, _ = w.Write(b)
	})
}

type requestClient struct {
	o         options
	roots     *x509.CertPool
	conn      *tls.Conn
	br        *bufio.Reader
	firstByte time.Time
}

type firstByteReader struct {
	io.Reader
	first *time.Time
}

func (r firstByteReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	if n > 0 && r.first.IsZero() {
		*r.first = time.Now()
	}
	return n, err
}
func (c *requestClient) close() {
	if c.conn != nil {
		_ = c.conn.Close()
		c.conn, c.br = nil, nil
	}
}

func (c *requestClient) one() (s sample) {
	start := time.Now()
	s = sample{Status: "FAIL", PromptBytes: c.o.promptBytes, StartMS: ms(start.Sub(epoch)), Reused: c.conn != nil}
	var failure error
	defer func() {
		s.ElapsedMS, s.EndMS = ms(time.Since(start)), ms(time.Since(epoch))
		if !c.firstByte.IsZero() {
			v := ms(c.firstByte.Sub(start))
			s.TTFBMS = &v
		}
		if failure != nil {
			s.Error = failure.Error()
			var n net.Error
			if errors.As(failure, &n) && n.Timeout() {
				s.Status = "TIMEOUT"
			}
		}
		if s.Status != "PASS" || !c.o.reuse {
			c.close()
		}
	}()
	c.firstByte = time.Time{}
	deadline := start.Add(c.o.timeout)
	if c.conn == nil {
		t0 := time.Now()
		d := net.Dialer{Deadline: deadline}
		raw, err := d.Dial("tcp4", net.JoinHostPort(c.o.address, strconv.Itoa(c.o.port)))
		v := ms(time.Since(t0))
		s.ApplicationTCPMS = &v
		if err != nil {
			failure = err
			return
		}
		_ = raw.SetDeadline(deadline)
		t0 = time.Now()
		conn := tls.Client(raw, &tls.Config{RootCAs: c.roots, ServerName: c.o.serverName,
			MinVersion: tls.VersionTLS13, MaxVersion: tls.VersionTLS13, NextProtos: []string{"http/1.1"}})
		err = conn.Handshake()
		tlsMS := ms(time.Since(t0))
		s.OriginTLSMS = &tlsMS
		if err != nil {
			_ = raw.Close()
			failure = err
			return
		}
		c.conn = conn
		c.br = bufio.NewReader(firstByteReader{Reader: conn, first: &c.firstByte})
	}
	_ = c.conn.SetDeadline(deadline)
	b, _ := json.Marshal(aiRequest{Prompt: strings.Repeat("P", c.o.promptBytes), ResponseBytes: c.o.responseBytes})
	s.RequestBodyBytes = len(b)
	req, _ := http.NewRequest("POST", "https://"+c.o.serverName+c.o.path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	// Explicit HTTP/1.1 write/read: no library retry or POST replay on a stale connection.
	if failure = req.Write(c.conn); failure != nil {
		return
	}
	resp, err := http.ReadResponse(c.br, req)
	if err != nil {
		failure = err
		return
	}
	defer resp.Body.Close()
	s.ConnectionID = resp.Header.Get("X-Tono-Connection-ID")
	if resp.StatusCode != 200 || resp.Header.Get("X-Prompt-Bytes") != strconv.Itoa(c.o.promptBytes) {
		failure = fmt.Errorf("HTTP %d or missing prompt acknowledgement", resp.StatusCode)
		return
	}
	if strings.Contains(c.o.path, "stream") {
		err = readEvents(io.LimitReader(resp.Body, int64(maxResponse+16384)), start, c.o.responseBytes, &s)
	} else {
		body, e := io.ReadAll(io.LimitReader(resp.Body, int64(maxResponse+16384)))
		s.ResponseBodyBytes = len(body)
		var reply struct {
			Text string `json:"text"`
		}
		err = e
		if err == nil {
			err = json.Unmarshal(body, &reply)
		}
		if err == nil && (len(reply.Text) != c.o.responseBytes || strings.Trim(reply.Text, "Z") != "") {
			err = errors.New("corrupt JSON reply")
		}
		if err == nil {
			s.ResponseBytes = len(reply.Text)
			s.Done = true
		}
	}
	if err != nil {
		failure = err
		return
	}
	if resp.Close {
		c.close()
	}
	s.Status = "PASS"
	return
}

func readEvents(body io.Reader, start time.Time, expected int, s *sample) error {
	scan := bufio.NewScanner(body)
	scan.Buffer(make([]byte, 4096), maxResponse)
	pending := ""
	for scan.Scan() {
		line := scan.Text()
		s.ResponseBodyBytes += len(line) + 1
		if line != "" {
			if !strings.HasPrefix(line, "data: ") || pending != "" {
				return errors.New("invalid synthetic SSE framing")
			}
			pending = strings.TrimPrefix(line, "data: ")
			continue
		}
		if pending == "" {
			continue
		}
		data := pending
		pending = "" // Dispatch only after the complete blank-line-delimited frame.
		if data == "[DONE]" {
			if s.Done {
				return errors.New("duplicate SSE completion")
			}
			s.Done = true
			continue
		}
		if s.Done {
			return errors.New("SSE data after completion")
		}
		var e event
		if err := json.Unmarshal([]byte(data), &e); err != nil {
			return err
		}
		if e.Index != len(s.Events) || len(e.Text) != expected/16 || strings.Trim(e.Text, "Z") != "" {
			return errors.New("invalid SSE event/order")
		}
		s.ResponseBytes += len(e.Text)
		e.Text = ""
		e.ClientArrivalMS = ms(time.Since(start))
		if s.FirstEventMS == nil {
			v := e.ClientArrivalMS
			s.FirstEventMS = &v
		}
		s.Events = append(s.Events, e)
	}
	if err := scan.Err(); err != nil {
		return err
	}
	if pending != "" || !s.Done || len(s.Events) != 16 || s.ResponseBytes != expected {
		return errors.New("incomplete SSE stream")
	}
	return nil
}

func batch(o options, roots *x509.CertPool) output {
	start := time.Now()
	out := output{Status: "PASS", Samples: make([]sample, o.count)}
	jobs := make(chan int, o.count)
	for i := 0; i < o.count; i++ {
		jobs <- i
	}
	close(jobs)
	var wg sync.WaitGroup
	for i := 0; i < o.concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c := &requestClient{o: o, roots: roots}
			defer c.close()
			for index := range jobs {
				out.Samples[index] = c.one()
			}
		}()
	}
	wg.Wait()
	for _, s := range out.Samples {
		if s.Status != "PASS" {
			out.Status = "FAIL"
		}
	}
	out.ElapsedMS = ms(time.Since(start))
	return out
}

func ms(d time.Duration) float64 { return float64(d) / float64(time.Millisecond) }
func fatalJSON(err error) {
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "FAIL", "error": err.Error()})
	os.Exit(2)
}
