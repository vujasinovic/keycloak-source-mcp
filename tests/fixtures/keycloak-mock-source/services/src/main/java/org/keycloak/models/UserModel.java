package org.keycloak.models;

/**
 * Model representing a Keycloak user.
 */
public interface UserModel {

    /**
     * Get the user ID.
     * @return user identifier
     */
    String getId();

    /**
     * Get the username.
     * @return username
     */
    String getUsername();

    /**
     * Get the user's email.
     * @return email address
     */
    String getEmail();

    /**
     * Check if the user's email is verified.
     * @return true if email is verified
     */
    boolean isEmailVerified();
}
