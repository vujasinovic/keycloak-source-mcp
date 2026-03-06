package org.keycloak.events;

import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

/**
 * Factory for creating EventListenerProvider instances.
 */
public interface EventListenerProviderFactory extends ProviderFactory {

    /**
     * Create a new EventListenerProvider.
     * @param session the keycloak session
     * @return a new provider instance
     */
    EventListenerProvider create(KeycloakSession session);

    /**
     * Initialize the factory.
     * @param config the configuration scope
     */
    void init(Object config);

    /**
     * Post-initialization callback.
     * @param factory the session factory
     */
    void postInit(KeycloakSessionFactory factory);

    /**
     * Get the provider ID.
     * @return the unique provider identifier
     */
    String getId();

    /**
     * Closes the factory.
     */
    void close();
}
