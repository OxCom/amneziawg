package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

type serverState struct {
	ServerPrivateKey string `json:"serverPrivateKey"`
	ServerPublicKey  string `json:"serverPublicKey"`

	// For address allocation
	SubnetCIDR string `json:"subnetCidr"` // e.g. 10.8.0.0/24
	ServerIP   string `json:"serverIp"`   // e.g. 10.8.0.1
	NextHost   int    `json:"nextHost"`   // next host octet/index inside subnet
}

type client struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	PublicKey string     `json:"publicKey"`
	PrivKey   string     `json:"privateKey"`
	Address   string     `json:"address"` // e.g. 10.8.0.2/32
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

type clientPublic struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	PublicKey string     `json:"publicKey"`
	Address   string     `json:"address"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

func toPublic(c client) clientPublic {
	return clientPublic{
		ID:        c.ID,
		Name:      c.Name,
		PublicKey: c.PublicKey,
		Address:   c.Address,
		CreatedAt: c.CreatedAt,
		ExpiresAt: c.ExpiresAt,
	}
}

type dlToken struct {
	Token     string    `json:"token"`
	ClientID  string    `json:"clientId"`
	ExpiresAt time.Time `json:"expiresAt"`
	Used      bool      `json:"used"`
}

type app struct {
	dataDir string
	iface   string
	port    int
	listen  string

	endpoint   string // WG_ENDPOINT domain:port (optional)
	adminToken string

	mu sync.Mutex
}

func main() {
	var dataDir, iface, listen string
	var port int

	flag.StringVar(&dataDir, "data-dir", "/data", "data dir")
	flag.StringVar(&iface, "iface", "wg0", "interface name")
	flag.IntVar(&port, "port", 51820, "listen port UDP")
	flag.StringVar(&listen, "listen", "0.0.0.0:8080", "http listen")
	flag.Parse()

	adminToken := os.Getenv("ADMIN_TOKEN")
	if adminToken == "" {
		log.Fatal("ADMIN_TOKEN is required")
	}

	a := &app{
		dataDir:    dataDir,
		iface:      iface,
		port:       port,
		listen:     listen,
		endpoint:   os.Getenv("WG_ENDPOINT"),
		adminToken: adminToken,
	}

	if err := os.MkdirAll(dataDir, 0o750); err != nil {
		log.Fatal(err)
	}

	// Subnet config must be provided by env at install-time (written by setup.sh into .env)
	subnet := os.Getenv("WG_SUBNET")
	if subnet == "" {
		log.Fatal("WG_SUBNET is required (e.g. 10.8.0.0/24)")
	}
	serverIP := strings.Split(os.Getenv("WG_ADDRESS"), "/")[0]
	if serverIP == "" {
		log.Fatal("WG_ADDRESS is required (e.g. 10.8.0.1/24)")
	}

	if err := a.ensureServerState(subnet, serverIP); err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	withAuth := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			got := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
			if subtle.ConstantTimeCompare([]byte(got), []byte(a.adminToken)) != 1 {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			h(w, r)
		}
	}

	mux.HandleFunc("/api/clients", withAuth(a.handleClients))
	mux.HandleFunc("/api/clients/", withAuth(a.handleClientByID))
	mux.HandleFunc("/dl/", a.handleDownloadToken) // public, token-gated

	log.Printf("listening on %s", listen)
	log.Fatal(http.ListenAndServe(listen, mux))
}

func (a *app) serverStatePath() string { return filepath.Join(a.dataDir, "server.json") }
func (a *app) clientsPath() string     { return filepath.Join(a.dataDir, "clients.json") }
func (a *app) tokensPath() string      { return filepath.Join(a.dataDir, "dl-tokens.json") }

func (a *app) ensureServerState(subnetCIDR, serverIP string) error {
	p := a.serverStatePath()
	if _, err := os.Stat(p); err == nil {
		return nil
	}

	_, ipnet, err := net.ParseCIDR(subnetCIDR)
	if err != nil {
		return fmt.Errorf("invalid WG_SUBNET: %w", err)
	}
	if !ipnet.Contains(net.ParseIP(serverIP)) {
		return fmt.Errorf("server ip %s is not in subnet %s", serverIP, subnetCIDR)
	}

	priv, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		return err
	}
	pub := priv.PublicKey()

	// Start allocating from host .2 (common convention). More generally, NextHost=2.
	st := serverState{
		ServerPrivateKey: priv.String(),
		ServerPublicKey:  pub.String(),
		SubnetCIDR:       subnetCIDR,
		ServerIP:         serverIP,
		NextHost:         2,
	}
	b, _ := json.MarshalIndent(&st, "", "  ")
	return os.WriteFile(p, b, 0o600)
}

func (a *app) readServerState() (serverState, error) {
	var st serverState
	b, err := os.ReadFile(a.serverStatePath())
	if err != nil {
		return st, err
	}
	if err := json.Unmarshal(b, &st); err != nil {
		return st, err
	}
	return st, nil
}

func (a *app) writeServerState(st serverState) error {
	b, _ := json.MarshalIndent(&st, "", "  ")
	return os.WriteFile(a.serverStatePath(), b, 0o600)
}

func (a *app) loadClients() ([]client, error) {
	if _, err := os.Stat(a.clientsPath()); os.IsNotExist(err) {
		return []client{}, nil
	}
	b, err := os.ReadFile(a.clientsPath())
	if err != nil {
		return nil, err
	}
	var cs []client
	if err := json.Unmarshal(b, &cs); err != nil {
		return nil, err
	}
	return cs, nil
}

func (a *app) saveClients(cs []client) error {
	b, _ := json.MarshalIndent(cs, "", "  ")
	return os.WriteFile(a.clientsPath(), b, 0o600)
}

func (a *app) loadTokens() ([]dlToken, error) {
	if _, err := os.Stat(a.tokensPath()); os.IsNotExist(err) {
		return []dlToken{}, nil
	}
	b, err := os.ReadFile(a.tokensPath())
	if err != nil {
		return nil, err
	}
	var ts []dlToken
	if err := json.Unmarshal(b, &ts); err != nil {
		return nil, err
	}
	return ts, nil
}

func (a *app) saveTokens(ts []dlToken) error {
	b, _ := json.MarshalIndent(ts, "", "  ")
	return os.WriteFile(a.tokensPath(), b, 0o600)
}

func (a *app) handleClients(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cs, err := a.loadClients()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.Header().Set("Content-Type", "application/json")

		out := make([]clientPublic, 0, len(cs))

		for _, c := range cs {
			out = append(out, toPublic(c))
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(out)
	case http.MethodPost:
		a.createClient(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *app) handleClientByID(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/clients/")
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "bad request", 400)
		return
	}
	id := parts[0]

	// /api/clients/{id}/config
	if len(parts) == 2 && parts[1] == "config" && r.Method == http.MethodGet {
		a.downloadConfig(w, r, id)
		return
	}
	// /api/clients/{id}/link
	if len(parts) == 2 && parts[1] == "link" && r.Method == http.MethodPost {
		a.createOneTimeLink(w, r, id)
		return
	}
	if r.Method == http.MethodDelete {
		a.deleteClient(w, r, id)
		return
	}
	http.Error(w, "not found", http.StatusNotFound)
}

func (a *app) createClient(w http.ResponseWriter, r *http.Request) {
	type req struct {
		Name      string  `json:"name"`
		ExpiresAt *string `json:"expiresAt"` // RFC3339
	}
	var q req
	if err := json.NewDecoder(r.Body).Decode(&q); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	name := strings.TrimSpace(q.Name)
	if name == "" {
		http.Error(w, "name required", 400)
		return
	}

	var exp *time.Time
	if q.ExpiresAt != nil && strings.TrimSpace(*q.ExpiresAt) != "" {
		t, err := time.Parse(time.RFC3339, strings.TrimSpace(*q.ExpiresAt))
		if err != nil {
			http.Error(w, "expiresAt must be RFC3339", 400)
			return
		}
		exp = &t
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	st, err := a.readServerState()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	cs, err := a.loadClients()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	addr, err := allocateNextAddress(&st)
	if err != nil {
		http.Error(w, "address allocation failed: "+err.Error(), 500)
		return
	}

	priv, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	pub := priv.PublicKey()

	id := makeID()
	c := client{
		ID:        id,
		Name:      name,
		PublicKey: pub.String(),
		PrivKey:   priv.String(),
		Address:   addr,
		CreatedAt: time.Now().UTC(),
		ExpiresAt: exp,
	}
	cs = append(cs, c)

	if err := a.saveClients(cs); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := a.writeServerState(st); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := a.applyServerConfig(st, cs); err != nil {
		http.Error(w, "apply failed: "+err.Error(), 500)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(toPublic(c))
}

func allocateNextAddress(st *serverState) (string, error) {
	ip, ipnet, err := net.ParseCIDR(st.SubnetCIDR)
	if err != nil {
		return "", err
	}
	_ = ip

	// This allocator supports only IPv4 /24..../16 style simply via host index within last octets.
	// It increments st.NextHost and returns /32 address.
	// For your use-case (defaults) this is fine; can be extended later.

	base := ipnet.IP.To4()
	if base == nil {
		return "", errors.New("only IPv4 subnet supported")
	}

	// Compute candidate IP by setting last octet to NextHost for /24.
	// If subnet is not /24, this is simplistic; you can later extend.
	maskOnes, _ := ipnet.Mask.Size()
	if maskOnes != 24 {
		return "", fmt.Errorf("subnet %s: only /24 supported by allocator currently", st.SubnetCIDR)
	}
	if st.NextHost < 2 || st.NextHost > 254 {
		return "", errors.New("address pool exhausted")
	}

	cand := net.IPv4(base[0], base[1], base[2], byte(st.NextHost))
	if cand.String() == st.ServerIP {
		st.NextHost++
		cand = net.IPv4(base[0], base[1], base[2], byte(st.NextHost))
	}
	addr := cand.String() + "/32"
	st.NextHost++
	return addr, nil
}

func (a *app) deleteClient(w http.ResponseWriter, r *http.Request, id string) {
	a.mu.Lock()
	defer a.mu.Unlock()

	st, err := a.readServerState()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	cs, err := a.loadClients()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	out := make([]client, 0, len(cs))
	found := false
	for _, c := range cs {
		if c.ID == id {
			found = true
			continue
		}
		out = append(out, c)
	}
	if !found {
		http.Error(w, "not found", 404)
		return
	}

	if err := a.saveClients(out); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := a.applyServerConfig(st, out); err != nil {
		http.Error(w, "apply failed: "+err.Error(), 500)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) applyServerConfig(st serverState, cs []client) error {
	var b strings.Builder
	b.WriteString("[Interface]\n")
	b.WriteString("PrivateKey = " + st.ServerPrivateKey + "\n")
	b.WriteString(fmt.Sprintf("ListenPort = %d\n", a.port))
	b.WriteString("\n")

	now := time.Now()
	for _, c := range cs {
		if c.ExpiresAt != nil && now.After(*c.ExpiresAt) {
			continue
		}
		b.WriteString("[Peer]\n")
		b.WriteString("PublicKey = " + c.PublicKey + "\n")
		ipOnly := strings.Split(c.Address, "/")[0]
		b.WriteString("AllowedIPs = " + ipOnly + "/32\n")
		b.WriteString("\n")
	}

	confPath := filepath.Join(a.dataDir, a.iface+".conf")
	if err := os.WriteFile(confPath, []byte(b.String()), 0o600); err != nil {
		return err
	}

	cmd := exec.Command("awg", "setconf", a.iface, confPath)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	return cmd.Run()
}

func (a *app) downloadConfig(w http.ResponseWriter, r *http.Request, id string) {
	c, st, err := a.findClientAndState(id)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			http.Error(w, "not found", 404)
			return
		}
		http.Error(w, err.Error(), 500)
		return
	}
	if c.ExpiresAt != nil && time.Now().After(*c.ExpiresAt) {
		http.Error(w, "expired", http.StatusGone)
		return
	}
	cfg, err := a.renderClientConfig(c, st)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.conf"`, sanitize(c.Name)))
	w.Write([]byte(cfg))
}

func (a *app) createOneTimeLink(w http.ResponseWriter, r *http.Request, id string) {
	// request: {"ttlSeconds": 3600} optional
	type req struct {
		TTLSeconds *int `json:"ttlSeconds"`
	}
	var q req
	_ = json.NewDecoder(r.Body).Decode(&q)
	ttl := 3600
	if q.TTLSeconds != nil && *q.TTLSeconds > 0 {
		ttl = *q.TTLSeconds
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	// validate client exists
	cs, err := a.loadClients()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	found := false
	for _, c := range cs {
		if c.ID == id {
			found = true
			break
		}
	}
	if !found {
		http.Error(w, "not found", 404)
		return
	}

	ts, err := a.loadTokens()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	token := randomToken(32)
	t := dlToken{
		Token:     token,
		ClientID:  id,
		ExpiresAt: time.Now().Add(time.Duration(ttl) * time.Second).UTC(),
		Used:      false,
	}
	ts = append(ts, t)
	if err := a.saveTokens(ts); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	// You can place UI behind HTTPS; link will be https://<host>/dl/<token>
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"urlPath":   "/dl/" + token,
		"expiresAt": t.ExpiresAt.Format(time.RFC3339),
	})
}

func (a *app) handleDownloadToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := strings.TrimPrefix(r.URL.Path, "/dl/")
	token = strings.TrimSpace(token)
	if token == "" {
		http.Error(w, "not found", 404)
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	ts, err := a.loadTokens()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	idx := -1
	for i := range ts {
		if ts[i].Token == token {
			idx = i
			break
		}
	}
	if idx < 0 {
		http.Error(w, "not found", 404)
		return
	}
	if ts[idx].Used {
		http.Error(w, "gone", http.StatusGone)
		return
	}
	if time.Now().After(ts[idx].ExpiresAt) {
		http.Error(w, "gone", http.StatusGone)
		return
	}

	// mark used
	ts[idx].Used = true
	if err := a.saveTokens(ts); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	c, st, err := a.findClientAndState(ts[idx].ClientID)
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}
	if c.ExpiresAt != nil && time.Now().After(*c.ExpiresAt) {
		http.Error(w, "expired", http.StatusGone)
		return
	}
	cfg, err := a.renderClientConfig(c, st)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.conf"`, sanitize(c.Name)))
	w.Write([]byte(cfg))
}

func (a *app) findClientAndState(id string) (client, serverState, error) {
	st, err := a.readServerState()
	if err != nil {
		return client{}, st, err
	}
	cs, err := a.loadClients()
	if err != nil {
		return client{}, st, err
	}
	for _, c := range cs {
		if c.ID == id {
			return c, st, nil
		}
	}
	return client{}, st, os.ErrNotExist
}

func (a *app) renderClientConfig(c client, st serverState) (string, error) {
	var b strings.Builder
	b.WriteString("[Interface]\n")
	b.WriteString("PrivateKey = " + c.PrivKey + "\n")
	b.WriteString("Address = " + c.Address + "\n")

	// extra lines (DPI/obfuscation/etc) — provided by installer, no defaults.
	extra := filepath.Join(a.dataDir, "client-extra-interface.txt")
	if bb, err := os.ReadFile(extra); err == nil {
		x := strings.TrimSpace(string(bb))
		if x != "" {
			b.WriteString(x + "\n")
		}
	}
	b.WriteString("\n[Peer]\n")
	b.WriteString("PublicKey = " + st.ServerPublicKey + "\n")
	if a.endpoint != "" {
		b.WriteString("Endpoint = " + a.endpoint + "\n")
	}

	allowed := "0.0.0.0/0, ::/0"
	if bb, err := os.ReadFile(filepath.Join(a.dataDir, "client-allowedips.txt")); err == nil {
		x := strings.TrimSpace(string(bb))
		if x != "" {
			allowed = x
		}
	}
	b.WriteString("AllowedIPs = " + allowed + "\n")
	return b.String(), nil
}

func makeID() string {
	buf := make([]byte, 18)
	_, _ = rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}

func randomToken(n int) string {
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}

func sanitize(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, s)
	return strings.Trim(s, "-")
}
