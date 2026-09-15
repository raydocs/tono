//go:build tono_mobile

// Package tonomobile is the deliberately small Objective-C binding surface.
// Bind this package, not libbox's command server / raw platform descriptor API.
package tonomobile

import (
	"encoding/json"
	"errors"
	"runtime/debug"
	"sync"
	"time"

	"github.com/sagernet/sing-box/experimental/libbox"
	"github.com/sagernet/sing-box/experimental/tonoios"
)

// buildIdentity is injected from the digest of the locked inputs by build-mobile.py.
// Empty is intentionally inadmissible in Swift. Not a claim of code signing.
var buildIdentity string

func Identity() string { return buildIdentity }

type Admission struct {
	draft   *tonoios.Draft
	expires time.Time
}

func (a *Admission) Locations() string {
	if a.draft == nil {
		return "[]"
	}
	b, _ := json.Marshal(a.draft.Locations())
	return string(b)
}

func Prepare(catalog, policy []byte, selected, previous string) (*Admission, error) {
	var watermark *tonoios.Watermark
	if previous != "" {
		var err error
		watermark, err = tonoios.DecodeWatermark([]byte(previous))
		if err != nil {
			return nil, errors.New("TONO_WATERMARK_INVALID")
		}
	}
	draft, err := tonoios.Compile(catalog, policy, selected, watermark)
	if err != nil {
		return nil, err
	}
	return &Admission{draft: draft, expires: time.Now().Add(30 * time.Second)}, nil
}
func (a *Admission) Watermark() string {
	if a.draft == nil {
		return ""
	}
	b, _ := json.Marshal(a.draft.Watermark())
	return string(b)
}
func (a *Admission) Start() (*Session, error) {
	if a.draft == nil || time.Now().After(a.expires) {
		return nil, errors.New("TONO_ADMISSION_EXPIRED")
	}
	debug.SetMemoryLimit(48 << 20) // soft limit; device jetsam acceptance still required
	core, err := libbox.TonoStart(a.draft.Configuration())
	if err != nil {
		return nil, err
	}
	s := &Session{core: core}
	// The extension must obtain fresh authenticated catalog/policy, then restart.
	// Monotonic timer closes even if Swift refresh stalls or wall time goes back.
	s.timer = time.AfterFunc(5*time.Minute, s.Close)
	return s, nil
}

type Session struct {
	core  *libbox.TonoPacketSession
	timer *time.Timer
	once  sync.Once
}

func (s *Session) Write(packet []byte) error {
	if s.core == nil {
		return errors.New("TONO_CLOSED")
	}
	return s.core.Write(packet)
}
func (s *Session) Read() ([]byte, error) {
	if s.core == nil {
		return nil, errors.New("TONO_CLOSED")
	}
	return s.core.Read()
}
func (s *Session) Probe() error {
	if s.core == nil {
		return errors.New("TONO_CLOSED")
	}
	return s.core.Probe()
}
func (s *Session) Close() {
	s.once.Do(func() {
		if s.timer != nil {
			s.timer.Stop()
		}
		if s.core != nil {
			s.core.Close()
		}
	})
}
