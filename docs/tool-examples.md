# Tool Usage Examples

Practical examples showing how to use each tool in `keycloak-source-mcp`. Examples are written as natural language prompts you can give to your AI assistant, along with the underlying tool calls and sample output.

---

## Source Navigation Tools

To find a class by name, just ask `explain_implementation` — it dispatches to the right deep-analysis routine. For ad-hoc text searches, use `grep_source`.

### get_class_source

Read the full source code of a Java class. If the exact path isn't found, the tool auto-discovers the file.

```
Prompt: "Show me the source code of AuthenticationProcessor"
Tool call: get_class_source("services/src/main/java/org/keycloak/authentication/AuthenticationProcessor.java")
```

```
Prompt: "Show me the Authenticator interface source"
Tool call: get_class_source("server-spi/src/main/java/org/keycloak/authentication/Authenticator.java")
```

```
Prompt: "Read the UsernamePasswordForm source from version 24"
Tool call: get_class_source("services/src/main/java/org/keycloak/authentication/authenticators/browser/UsernamePasswordForm.java", "v24")
```

### find_interface_implementors

Find all classes that implement an interface or extend a class. Useful for understanding extension points.

```
Prompt: "What classes implement the Authenticator interface?"
Tool call: find_interface_implementors("Authenticator")
```

```
Prompt: "Find all implementations of RequiredActionProvider"
Tool call: find_interface_implementors("RequiredActionProvider")
```

```
Prompt: "Show me all EventListenerProvider implementations in version 26"
Tool call: find_interface_implementors("EventListenerProvider", "v26")
```

### grep_source

Full-text regex search across the Keycloak source code.

```
Prompt: "Find all uses of @AutoService annotation in Java files"
Tool call: grep_source("@AutoService", "*.java", 10)
```

```
Prompt: "Search for token refresh logic"
Tool call: grep_source("refreshToken", "*.java")
```

```
Prompt: "Find all TODO comments in authentication-related files"
Tool call: grep_source("TODO", "**/authentication/**/*.java", 20)
```

```
Prompt: "Search for deprecated method usage in v24"
Tool call: grep_source("@Deprecated", "*.java", 50, "v24")
```

### search_spi_definitions

List SPI definitions from META-INF/services files. Shows which implementations are registered for each SPI.

```
Prompt: "Show me all Authenticator SPI definitions"
Tool call: search_spi_definitions("Authenticator")
```

```
Prompt: "List all registered SPIs"
Tool call: search_spi_definitions()
```

```
Prompt: "Find EventListener SPI definitions in version 24"
Tool call: search_spi_definitions("EventListener", "v24")
```

### trace_dependencies

Understand what a class depends on and what depends on it.

```
Prompt: "What does AuthenticationProcessor depend on?"
Tool call: trace_dependencies("AuthenticationProcessor", "upstream", 2)
```

```
Prompt: "What classes use the Authenticator interface?"
Tool call: trace_dependencies("Authenticator", "downstream", 2)
```

```
Prompt: "Show the full dependency graph for TokenManager"
Tool call: trace_dependencies("TokenManager", "both", 3)
```

### explain_implementation

The primary tool for understanding Keycloak internals. Accepts natural language queries about features, classes, or flows. Orchestrates deep source analysis including class hierarchies, interface methods, SPI extension points, implementations, and dependencies.

**Two modes of operation:**

1. **Class mode** — detects specific class names and provides deep analysis (source code, hierarchy, implementors, SPI registration, usages)
2. **Topic mode** — detects conceptual topics and orchestrates multiple searches for a comprehensive overview

**Class-mode examples:**

```
Prompt: "Explain how AuthenticationProcessor works"
Tool call: explain_implementation("AuthenticationProcessor")
→ Returns: Deep Analysis with full source, methods, hierarchy, implementors, dependencies, SPI registration
```

```
Prompt: "Explain how UsernamePasswordForm works"
Tool call: explain_implementation("Explain how UsernamePasswordForm works")
→ Returns: Deep Analysis including superclass hierarchy (AbstractUsernameFormAuthenticator → Authenticator)
```

```
Prompt: "What is RequiredActionProvider?"
Tool call: explain_implementation("RequiredActionProvider")
→ Returns: Interface methods with javadoc, known implementors (VerifyEmail, etc.), SPI registration
```

**Topic-mode examples:**

```
Prompt: "How does Keycloak handle authentication flows?"
Tool call: explain_implementation("authentication flow")
→ Returns: Key classes with descriptions, interface method signatures, default implementations, SPI extension points with registered providers
```

```
Prompt: "How does token refresh work?"
Tool call: explain_implementation("token refresh")
```

```
Prompt: "How does user federation work?"
Tool call: explain_implementation("user federation")
```

```
Prompt: "Explain required actions in version 24"
Tool call: explain_implementation("required action", "v24")
```

```
Prompt: "What happens during a password reset flow?"
Tool call: explain_implementation("password reset")
```

```
Prompt: "How does Keycloak handle login page rendering?"
Tool call: explain_implementation("login")
→ Returns: Key classes, interfaces, SPI extension points, plus FreeMarker templates (for UI-related topics)
```

---

## Version Management Tools

### list_versions

List all registered Keycloak source versions.

```
Prompt: "What Keycloak versions do I have set up?"
Tool call: list_versions()
```

Sample output:
```
Registered Keycloak Source Versions
============================================================
  v24  /Users/dev/keycloak-24  (default)
  v26  /Users/dev/keycloak-26
```

### compare_versions

Unified version comparison. Two modes:

- **`target: "class"`** (default) — diff a single class or interface. Pass `query` and optionally `mode: "diff" | "side_by_side"`.
- **`target: "spi_scan"`** — scan well-known SPIs (or a custom list) for BREAKING vs NON-BREAKING changes. Pass an optional `interfaces` list and optional explicit source paths.

**Class diff:**

```
Prompt: "What changed in the Authenticator interface between v24 and v26?"
Tool call: compare_versions(fromVersion="v24", toVersion="v26", query="Authenticator")
```

```
Prompt: "Show side-by-side diff of RealmModel between versions"
Tool call: compare_versions(fromVersion="v24", toVersion="v26", query="RealmModel", mode="side_by_side")
```

**SPI breaking-change scan:**

```
Prompt: "What SPI changes between v24 and v26 would break my custom Authenticator?"
Tool call: compare_versions(fromVersion="v24", toVersion="v26", target="spi_scan", interfaces=["Authenticator", "AuthenticatorFactory"])
```

```
Prompt: "Detect all breaking SPI changes between Keycloak 24.0.0 and 26.0.0"
Tool call: compare_versions(fromVersion="24.0.0", toVersion="26.0.0", target="spi_scan")
```

```
Prompt: "Check RequiredActionProvider against versions at explicit source paths"
Tool call: compare_versions(fromVersion="24.0.0", toVersion="26.0.0", target="spi_scan", interfaces=["RequiredActionProvider"], sourcePathV1="/path/to/kc-24", sourcePathV2="/path/to/kc-26")
```

---

## Upgrade & Security Tools

### upgrade_assistant

Analyze your custom SPI implementations for compatibility with a target Keycloak version.

```
Prompt: "Check if my custom extensions are compatible with Keycloak 26"
Tool call: upgrade_assistant("/projects/my-keycloak-spi", "26.0.0")
```

```
Prompt: "Analyze my SPI project against a specific Keycloak source checkout"
Tool call: upgrade_assistant("/projects/my-keycloak-spi", "26.0.0", "/path/to/keycloak-26-source")
```

### check_security_advisories

Check Keycloak's GitHub security advisories for CVEs affecting a version.

```
Prompt: "Are there any known vulnerabilities in Keycloak 24.0.3?"
Tool call: check_security_advisories("24.0.3")
```

```
Prompt: "Show critical CVEs affecting Keycloak 24.0.3"
Tool call: check_security_advisories("24.0.3", "critical")
```

```
Prompt: "Check for high-severity security issues in Keycloak 26.0.0"
Tool call: check_security_advisories("26.0.0", "high")
```

---

## Visualization & Admin Tools

### visualize_auth_flow

Generate a Mermaid flowchart diagram of a Keycloak authentication flow.

**From a realm export:**

```
Prompt: "Visualize the browser auth flow from my realm export"
Tool call: visualize_auth_flow("realm_export", "/tmp/realm-export.json", "browser")
```

```
Prompt: "Show the registration flow from my realm config"
Tool call: visualize_auth_flow("realm_export", "/tmp/realm-export.json", "registration")
```

**From a plain English description:**

```
Prompt: "Draw a flow diagram for: cookie SSO first, then username/password, then conditional OTP"
Tool call: visualize_auth_flow("description", undefined, undefined, "First cookie SSO, then username/password (required), then OTP (conditional)")
```

### keycloak_admin

Query a running Keycloak instance via the Admin REST API.

Requires env vars: `KEYCLOAK_ADMIN_URL`, `KEYCLOAK_ADMIN_USERNAME`, `KEYCLOAK_ADMIN_PASSWORD`

```
Prompt: "List all realms on my running Keycloak"
Tool call: keycloak_admin("list_realms")
```

```
Prompt: "Show authentication flows in the master realm"
Tool call: keycloak_admin("list_flows", "master")
```

```
Prompt: "List all clients in my-app realm"
Tool call: keycloak_admin("list_clients", "my-app")
```

```
Prompt: "Show registered providers"
Tool call: keycloak_admin("list_providers")
```

```
Prompt: "Get realm settings for my-app"
Tool call: keycloak_admin("get_realm_settings", "my-app")
```

---

## Live Development Intelligence Tools

These tools connect to a locally running Keycloak instance for real-time development assistance. Requires env vars: `KC_DEV_URL`, `KC_DEV_ADMIN_USERNAME`, `KC_DEV_ADMIN_PASSWORD`.

### connect_dev_instance

Test the connection to your running Keycloak dev instance.

```
Prompt: "Check if my Keycloak dev instance is running"
Tool call: connect_dev_instance()
```

Sample output:
```
Keycloak Dev Instance — Connected
  URL: http://localhost:8080
  Version: 26.0.1
  Custom providers detected: 2
    - SmsSenderAuthenticatorFactory (source found)
    - AuditEventListener (source not found)
```

### get_loaded_providers

List all SPI providers registered in the running instance, correlated with source code locations.

```
Prompt: "Show me all loaded providers"
Tool call: get_loaded_providers()
```

```
Prompt: "Show only authenticator providers"
Tool call: get_loaded_providers("authenticator")
```

```
Prompt: "List only custom (non-Keycloak-core) providers"
Tool call: get_loaded_providers(undefined, true)
```

### analyze_logs

Read and analyze recent Keycloak logs. Detects errors, stack traces, and authentication flow steps.

Requires `KC_DEV_LOG_PATH` env var pointing to the log file.

```
Prompt: "Analyze the last 200 lines of Keycloak logs"
Tool call: analyze_logs(200)
```

```
Prompt: "Show me recent authentication errors"
Tool call: analyze_logs(500, "AuthenticationProcessor")
```

```
Prompt: "Check for SPI registration errors in the last 1000 log lines"
Tool call: analyze_logs(1000, "SPI")
```

```
Prompt: "Analyze logs without extracting flow steps"
Tool call: analyze_logs(200, undefined, false)
```

### trace_authentication_flow

Get step-by-step instructions for triggering and tracing a specific authentication flow via logs.

```
Prompt: "Help me trace the browser login flow in my test realm"
Tool call: trace_authentication_flow("test-realm", "browser login with username and password")
```

```
Prompt: "Trace OTP authentication in the master realm"
Tool call: trace_authentication_flow("master", "browser login with OTP")
```

```
Prompt: "Help me trace direct grant authentication"
Tool call: trace_authentication_flow("my-realm", "direct grant with client credentials")
```

### validate_spi_registration

Validate that custom SPI providers are correctly registered and configured. Detects common registration mistakes like missing META-INF/services files.

```
Prompt: "Validate my custom SPI registrations"
Tool call: validate_spi_registration()
```

```
Prompt: "Check SPI registration in my extensions project"
Tool call: validate_spi_registration("/projects/my-keycloak-extensions")
```

### get_dev_instance_config

Inspect the active configuration of the running Keycloak instance, focused on SPI-relevant settings.

```
Prompt: "Show the full running Keycloak configuration"
Tool call: get_dev_instance_config()
```

```
Prompt: "Show only SPI-related configuration"
Tool call: get_dev_instance_config("kc.spi")
```

```
Prompt: "Check the datasource configuration"
Tool call: get_dev_instance_config("quarkus.datasource")
```

### diagnose_user

Investigate why a user can't log in. Searches by name, email, or username and checks account status, credentials, brute-force lockout, recent login events, and active sessions.

Requires `KC_DEV_URL`, `KC_DEV_ADMIN_USERNAME`, `KC_DEV_ADMIN_PASSWORD`.

```
Prompt: "Why can't alice@corp.com log in?"
Tool call: diagnose_user("alice@corp.com", "acme")
```

```
Prompt: "Diagnose login issues for user 'jdoe' in master realm"
Tool call: diagnose_user("jdoe")
```

```
Prompt: "Look up John Doe and tell me their account state"
Tool call: diagnose_user("John Doe", "acme")
```

---

## Common Workflows

### Building a Custom Authenticator

1. **Understand the full picture:** `explain_implementation("authentication flow")` — returns key classes, interfaces with method signatures, implementations, and SPI extension points in one call
2. **Deep-dive into the interface:** `explain_implementation("Authenticator")` — full source, methods with javadoc, known implementors, SPI registration
3. **Study an example implementation:** `explain_implementation("UsernamePasswordForm")` — full source with superclass hierarchy
4. **Check SPI registration pattern:** `search_spi_definitions("AuthenticatorFactory")`
5. **Explore a specific method:** `grep_source("authenticate\\(AuthenticationFlowContext", "*.java")`

### Upgrading Custom Extensions

1. **List your versions:** `list_versions()`
2. **Check interface changes:** `compare_versions(fromVersion="v24", toVersion="v26", query="Authenticator")`
3. **Scan for breaking SPI changes:** `compare_versions(fromVersion="v24", toVersion="v26", target="spi_scan", interfaces=["Authenticator", "AuthenticatorFactory"])`
4. **Run the upgrade assistant:** `upgrade_assistant("/projects/my-spi", "26.0.0")`
5. **Check for CVEs:** `check_security_advisories("26.0.0")`

### Debugging a Running Instance

1. **Verify connection:** `connect_dev_instance()`
2. **Check loaded providers:** `get_loaded_providers(undefined, true)`
3. **Validate SPI registration:** `validate_spi_registration("/projects/my-spi")`
4. **Analyze logs for errors:** `analyze_logs(500)`
5. **Trace a specific flow:** `trace_authentication_flow("my-realm", "browser login")`
6. **Inspect config:** `get_dev_instance_config("kc.spi")`

### Diagnosing a User Login Issue

1. **Find and diagnose the user:** `diagnose_user("alice@corp.com", "my-realm")` — checks account status, credentials, brute-force lockout, recent events, active sessions
2. **If the issue is in the flow itself:** `trace_authentication_flow("my-realm", "browser login with OTP")` — guidance + log analysis after the user retries
3. **Read recent errors:** `analyze_logs(500, "authentication")`
4. **Read the throwing method source:** `get_class_source("services/src/.../AuthenticationProcessor.java")`
