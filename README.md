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

## License

MIT
