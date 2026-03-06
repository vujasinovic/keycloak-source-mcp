package org.keycloak.authentication.authenticators;

import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

/**
 * Abstract base class for authenticators that use a username form.
 * Provides common functionality for username-based authentication.
 */
public abstract class AbstractUsernameFormAuthenticator implements Authenticator {

    /**
     * Validate the username from the form submission.
     * @param context the authentication flow context
     * @param username the submitted username
     * @return true if valid
     */
    protected boolean validateUser(AuthenticationFlowContext context, String username) {
        // Base validation logic
        return username != null && !username.isEmpty();
    }

    @Override
    public boolean requiresUser() {
        return false;
    }

    @Override
    public void close() {
        // No resources to clean up
    }
}
