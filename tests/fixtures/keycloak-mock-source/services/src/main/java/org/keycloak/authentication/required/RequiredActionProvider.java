package org.keycloak.authentication.required;

import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

/**
 * A required action is an action that must be completed by the user
 * before authentication can be considered complete.
 */
public interface RequiredActionProvider extends Provider {

    /**
     * Called when a required action is triggered.
     * @param context the required action context
     */
    void requiredActionChallenge(RequiredActionContext context);

    /**
     * Process the action form submission.
     * @param context the required action context
     */
    void processAction(RequiredActionContext context);

    /**
     * Evaluate whether this required action should be triggered.
     * @param context the required action context
     */
    void evaluateTriggers(RequiredActionContext context);

    /**
     * Closes the provider.
     */
    void close();
}
