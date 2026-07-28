# Preview Configuration

Preserve the existing `config.yaml` and update only the required fields.

```yaml
listen: true
port: 8000
listenAddress:
  ipv4: 0.0.0.0
protocol:
  ipv4: true
  ipv6: false
browserLaunch:
  enabled: false
```

For a network-accessible instance, enable one supported authentication mechanism:

- User accounts
- Basic authentication
- A restrictive IP whitelist

`securityOverride: true`, `whitelistMode: false`, and disabled user authentication expose the instance to every client that can reach the preview URL. Use that combination only for an explicitly approved temporary environment.
