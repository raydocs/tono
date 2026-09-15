//go:build tono_mobile

package tonomobile

import (
	"strings"
	"testing"
	"time"

	"github.com/sagernet/sing-box/experimental/tonoios"
)

func TestMobilePersistedReceiptAndExpiredAdmission(t *testing.T) {
	hash := strings.Repeat("A", 43)
	valid := `{"catalog":{"number":7,"digest":"` + hash + `"},"policy":{"number":4,"digest":"` + hash + `"}}`
	if _, err := tonoios.DecodeWatermark([]byte(valid)); err != nil {
		t.Fatal(err)
	}
	if _, err := tonoios.DecodeWatermark([]byte(`{"catalog":{},"policy":{}}`)); err == nil {
		t.Fatal("corrupt receipt reset revisions")
	}
	if _, err := tonoios.DecodeWatermark([]byte(strings.Replace(valid, `"number":7`, `"number":7,"number":1`, 1))); err == nil {
		t.Fatal("duplicate receipt accepted")
	}
	a := &Admission{draft: &tonoios.Draft{}, expires: time.Now().Add(-time.Second)}
	if _, err := a.Start(); err == nil {
		t.Fatal("expired admission started")
	}
	if _, err := Prepare(nil, nil, "", "{}"); err == nil || err.Error() != "TONO_WATERMARK_INVALID" {
		t.Fatal("invalid receipt bypassed", err)
	}
	// gomobile exposes zero-value constructors. They must never panic/open traffic.
	s := &Session{}
	s.Close()
	if s.Probe() == nil {
		t.Fatal("zero session healthy")
	}
}
