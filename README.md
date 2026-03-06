# keycloak-source-mcp

An MCP (Model Context Protocol) server that allows AI assistants to navigate and understand [Keycloak](https://github.com/keycloak/keycloak) source code locally. Built for developers creating Keycloak customizations — SPIs, Authenticators, Required Actions, Token Handlers, User Policies, and more.

## Prerequisites

- **Node.js 18+**
- **Keycloak source code** cloned locally
- **ripgrep** (`rg`) recommended for fast search — falls back to `grep` if not installed

## Installation

### Quick Start with npx

No installation needed — just configure your MCP client:

```json
{
  "mcpServers": {
    "keycloak-source": {
      "command": "npx",
      "args": ["-y", "keycloak-source-mcp"],
      "env": {
        "KEYCLOAK_SOURCE_PATH": "/absolute/path/to/your/keycloak/source"
      }
    }
  }
}
```

### Clone Keycloak Source

```bash
git clone https://github.com/keycloak/keycloak.git
```

### Install ripgrep (recommended)

```bash
# macOS
brew install ripgrep

# Ubuntu/Debian
sudo apt install ripgrep

# Windows
choco install ripgrep
```

## Configuration

Set the `KEYCLOAK_SOURCE_PATH` environment variable to point to your local Keycloak source checkout:

```bash
export KEYCLOAK_SOURCE_PATH=/path/to/keycloak
```

## Tools

### search_class

Search for a Java class or interface by name.

```
> search_class("AuthenticationProcessor")

Search results for class: "AuthenticationProcessor"
  services/src/main/java/org/keycloak/authentication/AuthenticationProcessor.java
    Package: org.keycloak.authentication
    public class AuthenticationProcessor {
```

### get_class_source

Get the full source code of a Java class.

```
> get_class_source("services/src/main/java/org/keycloak/authentication/AuthenticationProcessor.java")

File: services/src/main/java/org/keycloak/authentication/AuthenticationProcessor.java
============================================================

package org.keycloak.authentication;
...
```

### find_interface_implementors

Find all classes that implement a given interface or extend a given class.

```
> find_interface_implementors("Authenticator")

Implementors/subclasses of: "Authenticator"
  services/src/main/java/org/keycloak/authentication/authenticators/browser/UsernamePasswordForm.java:25
    public class UsernamePasswordForm extends AbstractUsernameFormAuthenticator implements Authenticator
  ...
```

### search_spi_definitions

List SPI definitions from META-INF/services files.

```
> search_spi_definitions("Authenticator")

SPI Definitions (filter: "Authenticator")
============================================================
Found 2 SPI definition(s):

  SPI Interface: org.keycloak.authentication.AuthenticatorFactory
  File: services/src/main/resources/META-INF/services/org.keycloak.authentication.AuthenticatorFactory
  Implementations:
    - org.keycloak.authentication.authenticators.browser.UsernamePasswordFormFactory
    ...
```

### grep_source

Full-text regex search across the entire codebase.

```
> grep_source("@AutoService", "*.java", 10)

Search results for: "@AutoService" (files: *.java)
  server-spi/src/main/java/org/keycloak/provider/Spi.java:3:import com.google.auto.service.AutoService;
  ...
```

### explain_implementation

Understand how a Keycloak feature works — finds key classes, interfaces, implementations, and SPI extension points.

```
> explain_implementation("authentication flow")

Keycloak Implementation Analysis: "authentication flow"
============================================================

Key Classes
----------------------------------------
  services/src/main/java/org/keycloak/authentication/AuthenticationProcessor.java:42:
    public class AuthenticationProcessor {

Main Interfaces
----------------------------------------
  server-spi/src/main/java/org/keycloak/authentication/Authenticator.java:8:
    public interface Authenticator extends Provider {

Default Implementations
----------------------------------------
  services/src/main/java/org/keycloak/authentication/authenticators/browser/UsernamePasswordForm.java:25:
    public class UsernamePasswordForm extends AbstractUsernameFormAuthenticator implements Authenticator

SPI Extension Points
----------------------------------------
  services/src/main/resources/META-INF/services/org.keycloak.authentication.AuthenticatorFactory
```

## Advanced Tools

### generate_spi_boilerplate

Generate a ready-to-use Java SPI implementation skeleton with Provider class, Factory class, META-INF/services entry, and pom.xml dependencies.

- **Inputs:** `spiType`, `description`, `providerName`, `packageName`
- **Example prompt:** *"Generate an Authenticator SPI that sends an SMS verification code. Call it SmsSender in the com.mycompany.keycloak package."*

```
> generate_spi_boilerplate("Authenticator", "Send SMS verification code during login", "SmsSender", "com.mycompany.keycloak")
```

### detect_breaking_changes

Compare Keycloak SPI interfaces between two source versions to detect breaking changes.

- **Inputs:** `fromVersion`, `toVersion`, optionally `interfaceNames`, `sourcePathV1`, `sourcePathV2`
- **Example prompt:** *"What SPI interfaces changed between Keycloak 24 and 26 that would affect my custom Authenticator?"*

```
> detect_breaking_changes("24.0.0", "26.0.0", ["Authenticator", "AuthenticatorFactory"])
```

### trace_dependencies

Trace what a Keycloak class depends on and what depends on it — understand the blast radius.

- **Inputs:** `className`, `direction` (upstream/downstream/both), optionally `depth`
- **Example prompt:** *"What does AuthenticationProcessor depend on, and what uses it?"*

```
> trace_dependencies("AuthenticationProcessor", "both", 2)
```

### keycloak_admin

Connect to a running Keycloak instance and perform administrative queries.

- **Inputs:** `action` (list_realms, list_flows, list_clients, list_providers, get_realm_settings), optionally `realm`
- **Additional env vars:** `KEYCLOAK_ADMIN_URL`, `KEYCLOAK_ADMIN_USERNAME`, `KEYCLOAK_ADMIN_PASSWORD`, optionally `KEYCLOAK_ADMIN_REALM`, `KEYCLOAK_ADMIN_CLIENT_ID`
- **Example prompt:** *"Show me all authentication flows in the master realm of my running Keycloak."*

```
> keycloak_admin("list_flows", "master")
```

### upgrade_assistant

Analyze your custom SPI implementations and detect compatibility issues when upgrading Keycloak.

- **Inputs:** `customSourcePath`, `targetKeycloakVersion`, optionally `currentKeycloakSourcePath`
- **Example prompt:** *"Check if my custom extensions in /projects/my-keycloak-spi are compatible with Keycloak 26."*

```
> upgrade_assistant("/projects/my-keycloak-spi", "26.0.0")
```

### visualize_auth_flow

Visualize a Keycloak authentication flow as a Mermaid flowchart diagram from a realm export or plain English description.

- **Inputs:** `source` (realm_export or description), `realmExportPath`, `flowName`, `description`
- **Example prompt:** *"Visualize the browser authentication flow from my realm export at /tmp/realm-export.json"*

```
> visualize_auth_flow("realm_export", "/tmp/realm-export.json", "browser")
> visualize_auth_flow("description", undefined, undefined, "First cookie SSO, then username/password (required), then OTP (conditional)")
```

### check_security_advisories

Check Keycloak's GitHub security advisories for known CVEs affecting a specific version.

- **Inputs:** `keycloakVersion`, optionally `severity` (all/critical/high/medium/low)
- **Example prompt:** *"Are there any critical CVEs affecting Keycloak 24.0.3?"*

```
> check_security_advisories("24.0.3", "critical")
```

## Claude Desktop Configuration

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "keycloak-source": {
      "command": "npx",
      "args": ["-y", "keycloak-source-mcp"],
      "env": {
        "KEYCLOAK_SOURCE_PATH": "/absolute/path/to/your/keycloak/source"
      }
    }
  }
}
```

## Example Conversations

**"How does Keycloak handle authentication flows?"**
Use `explain_implementation("authentication flow")` to get an overview, then `get_class_source` on `AuthenticationProcessor` for details.

**"I want to build a custom Authenticator SPI"**
Use `search_spi_definitions("Authenticator")` to see existing SPIs, then `find_interface_implementors("Authenticator")` to study how built-in authenticators are implemented.

**"Where is the token refresh logic?"**
Use `grep_source("refreshToken", "*.java")` or `explain_implementation("token refresh")` to find the relevant code paths.

**"Show me how Required Actions work"**
Use `explain_implementation("required action")` to discover the key interfaces, then `get_class_source` on `RequiredActionProvider` to read the interface contract.

## Development

```bash
npm install
npm run build
npm start
```

## Roadmap

Potential future tools:

- **Multi-realm diff across environments** — Compare realm configurations between dev, staging, and production
- **Automated upgrade PR generator** — Generate a pull request with all needed changes to upgrade custom SPIs
- **Keycloak Operator CRD assistant** — Help build and validate custom resources for the Keycloak Operator
- **Performance profiling hints based on SPI usage patterns** — Detect common performance anti-patterns in custom implementations

## License

MIT
