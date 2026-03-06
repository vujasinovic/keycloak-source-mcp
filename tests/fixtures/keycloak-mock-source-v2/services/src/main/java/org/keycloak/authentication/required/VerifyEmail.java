package org.keycloak.authentication.required;

import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

/**
 * Required action that verifies a user's email address.
 */
public class VerifyEmail implements RequiredActionProvider {

    @Override
    public void requiredActionChallenge(RequiredActionContext context) {
        // Send verification email
    }

    @Override
    public void processAction(RequiredActionContext context) {
        // Verify the email token
    }

    @Override
    public void evaluateTriggers(RequiredActionContext context) {
        // Check if email is verified
    }

    @Override
    public void close() {
        // No resources to clean up
    }
}
