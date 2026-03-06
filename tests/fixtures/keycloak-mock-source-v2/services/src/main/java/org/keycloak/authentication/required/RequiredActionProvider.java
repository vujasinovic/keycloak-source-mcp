package org.keycloak.authentication.required;

import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

/**
 * Required action provider - v2 with evaluateTriggers removed.
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
     * NEW in v2: Get the display text for this required action.
     * @return display text
     */
    default String getDisplayText() {
        return "";
    }

    /**
     * Closes the provider.
     */
    void close();
}
