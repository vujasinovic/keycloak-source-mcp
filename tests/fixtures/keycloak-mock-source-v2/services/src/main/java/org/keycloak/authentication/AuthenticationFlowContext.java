package org.keycloak.authentication;

import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

/**
 * Encapsulates the current state of an authentication flow execution.
 */
public interface AuthenticationFlowContext {

    /**
     * Get the realm associated with this authentication.
     * @return the realm model
     */
    RealmModel getRealm();

    /**
     * Get the user being authenticated, may be null if not yet identified.
     * @return the user model or null
     */
    UserModel getUser();

    /**
     * Mark the authentication as successful.
     */
    void success();

    /**
     * Mark the authentication as failed.
     */
    void failure(AuthenticationFlowError error);

    /**
     * Challenge the user with a form or redirect.
     * @param response the challenge response
     */
    void challenge(Object response);

    /**
     * Get the current execution status.
     * @return execution status string
     */
    String getStatus();
}
