# Tool Usage Examples

Practical examples showing how to use each tool in `keycloak-source-mcp`. Examples are written as natural language prompts you can give to your AI assistant, along with the underlying tool calls and sample output.

---

## Source Navigation Tools

### search_class

Find Java classes or interfaces by name. Supports partial names and wildcards.

```
Prompt: "Find the AuthenticationProcessor class in Keycloak"
Tool call: search_class("AuthenticationProcessor")
```

```
Prompt: "Search for all classes with 'Token' in the name"
Tool call: search_class("Token")
```

```
Prompt: "Find the RealmModel class in the v24 source"
Tool call: search_class("RealmModel", "v24")
```

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

Get a high-level overview of how a Keycloak feature works. Finds key classes, interfaces, implementations, and SPI extension points.

```
Prompt: "How does Keycloak handle authentication flows?"
Tool call: explain_implementation("authentication flow")
```

```
Prompt: "Explain how token refresh works"
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

### compare_across_versions

Compare a class or interface between two Keycloak versions. Shows added, removed, and changed methods.

```
Prompt: "What changed in the Authenticator interface between v24 and v26?"
Tool call: compare_across_versions("Authenticator", "v24", "v26")
```

```
Prompt: "Show side-by-side diff of RealmModel between versions"
Tool call: compare_across_versions("RealmModel", "v24", "v26", "side_by_side")
```

```
Prompt: "Did the AuthenticatorFactory interface change between v24 and v26?"
Tool call: compare_across_versions("AuthenticatorFactory", "v24", "v26", "diff")
```

### detect_breaking_changes

Compare SPI interfaces between two versions to detect breaking changes that would affect custom extensions.

```
Prompt: "What SPI changes between v24 and v26 would break my custom Authenticator?"
Tool call: detect_breaking_changes("v24", "v26", ["Authenticator", "AuthenticatorFactory"])
```

```
Prompt: "Detect all breaking SPI changes between Keycloak 24.0.0 and 26.0.0"
Tool call: detect_breaking_changes("24.0.0", "26.0.0")
```

```
Prompt: "Check if RequiredActionProvider changed between versions using explicit source paths"
Tool call: detect_breaking_changes("24.0.0", "26.0.0", ["RequiredActionProvider"], "/path/to/kc-24", "/path/to/kc-26")
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

### debug_auth_flow

Real-time two-phase auth flow debugger. Captures a log snapshot, waits for you to trigger a flow, then produces a source-annotated trace showing what each authenticator did.

Requires `KC_DEV_LOG_PATH`. `KC_DEV_URL` is optional (enriches output with realm config).

**Phase 1 — Start (capture snapshot):**

```
Prompt: "Start debugging an auth flow in my test realm"
Tool call: debug_auth_flow("start", "test-realm", "browser login with OTP")
```

Sample output:
```
Debug Auth Flow — Snapshot Captured
============================================================
Log file: /tmp/keycloak.log
Current position: line 1542
Captured at: 2024-01-15T10:39:00.000Z

Now trigger your authentication flow:
  Browser login: http://localhost:8080/realms/test-realm/account
  Direct grant: curl -X POST http://localhost:8080/realms/test-realm/protocol/openid-connect/token ...

Scenario: browser login with OTP

After the flow completes, call debug_auth_flow with phase: "analyze"
and pass the following snapshot:

SNAPSHOT: {"logPath":"/tmp/keycloak.log","lineCount":1542,"takenAt":"2024-01-15T10:39:00.000Z"}
```

**Phase 2 — Analyze (produce annotated trace):**

```
Prompt: "Analyze the auth flow I just triggered"
Tool call: debug_auth_flow("analyze", "test-realm", undefined, '{"logPath":"/tmp/keycloak.log","lineCount":1542,"takenAt":"2024-01-15T10:39:00.000Z"}')
```

Sample output:
```
Authentication Flow Debug Trace
============================================================
Realm: test-realm | New log lines analyzed: 12 | Duration: 3099ms
Expected flow: browser

-- Step 1: auth-cookie -- ATTEMPTED
   Logger: org.keycloak.authentication.AuthenticationProcessor
   Log: Executing authenticator: auth-cookie
   Log: No valid SSO cookie found, skipping cookie auth
   Source: CookieAuthenticator.java
     authenticate(): Checks for AUTH_SESSION_ID cookie, attempts SSO

-- Step 2: identity-provider-redirector -- ATTEMPTED
   Logger: org.keycloak.authentication.AuthenticationProcessor
   Log: Executing authenticator: identity-provider-redirector
   Log: No default identity provider configured, skipping
   Source: IdentityProviderAuthenticator.java

-- Step 3: auth-username-password-form -- SUCCESS
   Logger: org.keycloak.authentication.AuthenticationProcessor
   Log: Executing authenticator: auth-username-password-form
   Log: Authenticator auth-username-password-form: SUCCESS
   Source: UsernamePasswordForm.java
     authenticate(): Display the login form
     action(): Validate the submitted credentials

-- Step 4: auth-otp-form -- SUCCESS
   Logger: org.keycloak.authentication.AuthenticationProcessor
   Log: Authenticator auth-otp-form: SUCCESS

-- Result: SUCCESS
```

```
Prompt: "Start a debug session for a direct grant flow"
Tool call: debug_auth_flow("start", "master", "direct grant with password")
```

```
Prompt: "Debug the auth flow using Keycloak v24 source"
Tool call: debug_auth_flow("analyze", "master", undefined, '{"logPath":"/tmp/kc.log","lineCount":100,"takenAt":"..."}', "v24")
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

---

## Common Workflows

### Building a Custom Authenticator

1. **Discover the interface:** `explain_implementation("authentication flow")`
2. **Study the SPI contract:** `get_class_source("server-spi/src/.../Authenticator.java")`
3. **See existing examples:** `find_interface_implementors("Authenticator")`
4. **Read an example implementation:** `get_class_source("services/src/.../UsernamePasswordForm.java")`
5. **Check SPI registration pattern:** `search_spi_definitions("AuthenticatorFactory")`

### Upgrading Custom Extensions

1. **List your versions:** `list_versions()`
2. **Check interface changes:** `compare_across_versions("Authenticator", "v24", "v26")`
3. **Detect breaking changes:** `detect_breaking_changes("v24", "v26", ["Authenticator", "AuthenticatorFactory"])`
4. **Run the upgrade assistant:** `upgrade_assistant("/projects/my-spi", "26.0.0")`
5. **Check for CVEs:** `check_security_advisories("26.0.0")`

### Debugging a Running Instance

1. **Verify connection:** `connect_dev_instance()`
2. **Check loaded providers:** `get_loaded_providers(undefined, true)`
3. **Validate SPI registration:** `validate_spi_registration("/projects/my-spi")`
4. **Analyze logs for errors:** `analyze_logs(500)`
5. **Trace a specific flow:** `trace_authentication_flow("my-realm", "browser login")`
6. **Inspect config:** `get_dev_instance_config("kc.spi")`

### Debugging a Specific Auth Flow (Step-by-Step)

1. **Start the debug session:** `debug_auth_flow("start", "my-realm", "browser login with OTP")`
2. **Trigger the flow** in your browser or via curl (follow the instructions in the output)
3. **Analyze the results:** `debug_auth_flow("analyze", "my-realm", undefined, "<snapshot JSON from step 1>")`
4. **If errors occurred**, the output includes an Error Diagnosis section with the exception, root cause, and source file reference
5. **Read the throwing method source:** `get_class_source("services/src/.../AuthenticationProcessor.java")`
