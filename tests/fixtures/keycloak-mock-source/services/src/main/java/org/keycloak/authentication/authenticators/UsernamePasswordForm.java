package org.keycloak.authentication.authenticators;

import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

/**
 * Username/password form authenticator implementation.
 * Handles standard username and password authentication.
 */
public class UsernamePasswordForm extends AbstractUsernameFormAuthenticator {

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        // Display the login form
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        // Validate the submitted credentials
    }

    @Override
    public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
        return true;
    }

    @Override
    public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {
        // No required actions needed
    }
}
