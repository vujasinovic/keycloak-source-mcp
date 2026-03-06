package org.keycloak.models;

/**
 * Model representing a Keycloak realm.
 */
public interface RealmModel {

    /**
     * Get the realm ID.
     * @return realm identifier
     */
    String getId();

    /**
     * Get the realm name.
     * @return realm name
     */
    String getName();

    /**
     * Check if the realm is enabled.
     * @return true if enabled
     */
    boolean isEnabled();
}
