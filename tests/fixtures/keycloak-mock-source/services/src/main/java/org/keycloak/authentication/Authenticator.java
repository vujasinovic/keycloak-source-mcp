package org.keycloak.authentication;

import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

/**
 * An authenticator is responsible for authenticating a user
 * in the context of an authentication flow.
 */
public interface Authenticator extends Provider {

    /**
     * Called to authenticate a user. The authenticator should check
     * the context for the current state of authentication.
     * @param context the authentication flow context
     */
    void authenticate(AuthenticationFlowContext context);

    /**
     * Called after a form action has been submitted.
     * @param context the authentication flow context
     */
    void action(AuthenticationFlowContext context);

    /**
     * Does this authenticator require the user to already be identified?
     * @return true if a user is required
     */
    boolean requiresUser();

    /**
     * Is this authenticator configured for the given user?
     * @param session the keycloak session
     * @param realm the realm
     * @param user the user
     * @return true if configured
     */
    boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user);

    /**
     * Set required actions for a user if their credentials
     * are not configured for this authenticator.
     * @param session the keycloak session
     * @param realm the realm
     * @param user the user
     */
    void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user);

    /**
     * Closes the provider and releases resources.
     */
    void close();
}
