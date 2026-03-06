package org.keycloak.events;

/**
 * Listener that receives events from the Keycloak server.
 * Used to audit, log, or trigger external actions on events.
 */
public interface EventListenerProvider extends Provider {

    /**
     * Called when a user event occurs (login, logout, register, etc).
     * @param event the event details
     */
    void onEvent(Event event);

    /**
     * Called when an admin event occurs.
     * @param event the admin event details
     * @param includeRepresentation whether to include the resource representation
     */
    void onEvent(AdminEvent event, boolean includeRepresentation);

    /**
     * Closes the provider.
     */
    void close();
}
