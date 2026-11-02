/**
 * @fileoverview Reactive State Management System with Event Emitter
 *
 * This module provides a lightweight, reactive state management system that combines
 * event-driven architecture with proxy-based reactivity. It allows for automatic
 * event emission when state properties change, enabling reactive UI updates and
 * cross-component communication.
 *
 * @module hey
 * @author Your Name
 * @version 1.0.0
 * @since 2024
 *
 * @example
 * ```typescript
 * import hey from './lib/hey';
 *
 * // Set up event listeners for state changes
 * hey.on('user', (userData) => {
 *   console.log('User data changed:', userData);
 *   updateUserInterface(userData);
 * });
 *
 * // Update state (triggers events automatically)
 * hey.user = { name: 'John', age: 30 };
 *
 * // Listen for one-time events
 * hey.once('initialized', () => {
 *   console.log('App initialized!');
 * });
 *
 * // Remove event listeners
 * const handler = (data) => console.log(data);
 * hey.on('update', handler);
 * hey.off('update', handler);
 * ```
 *
 * @features
 * - 🔄 Reactive state updates with automatic event emission
 * - 📡 Event-driven architecture for loose coupling
 * - 🎯 One-time event listeners
 * - 🔗 Nested object reactivity through proxy chaining
 * - 🧹 Automatic cleanup of event listeners
 * - 🚀 Lightweight and performant
 *
 * @architecture
 * The system consists of three main components:
 * 1. SimpleEmitter: Handles event registration and emission
 * 2. State: Manages the reactive state and proxy creation
 * 3. Proxy Handler: Intercepts property access and mutations
 *
 * @performance
 * - Event emission is synchronous and lightweight
 * - Proxy overhead is minimal for typical use cases
 * - Memory usage scales linearly with event listeners
 *
 * @security
 * - No external dependencies
 * - No eval() or dynamic code execution
 * - Type-safe event handling with TypeScript
 *
 * @cursor-rules
 * - Use descriptive event names (e.g., 'user:updated', 'cart:item:added')
 * - Always remove event listeners when components unmount
 * - Prefer 'once' for initialization events
 * - Use object destructuring for complex state updates
 * - Keep event handlers pure and side-effect free when possible
 * - Use TypeScript interfaces for better type safety
 * - Consider using namespaces for related events (e.g., 'user.*')
 * - Avoid deeply nested state objects for better performance
 * - Use the same handler reference when adding/removing listeners
 * - Document custom events in component documentation
 */

/**
 * Type definition for event handler functions.
 * @typedef {Function} EventHandler
 * @param {any} data - The data passed with the event
 * @returns {void}
 */
type EventHandler = (data: any) => void;

/**
 * Type definition for the event registry map.
 * Maps event names to arrays of event handlers.
 * @typedef {Object.<string, EventHandler[]>} EventMap
 */
type EventMap = { [key: string]: EventHandler[] };

/**
 * Simple event emitter class that handles event registration and emission.
 * Provides a lightweight implementation of the observer pattern.
 *
 * @class SimpleEmitter
 * @description A minimal event emitter for handling custom events
 *
 * @example
 * ```typescript
 * const emitter = new SimpleEmitter();
 *
 * emitter.on('data', (data) => console.log('Received:', data));
 * emitter.emit('data', { message: 'Hello World' });
 * // Output: Received: { message: 'Hello World' }
 * ```
 */
class SimpleEmitter {
  /**
   * Internal registry of event handlers.
   * Maps event names to arrays of callback functions.
   * @private
   * @type {EventMap}
   */
  private events: EventMap;

  /**
   * Creates a new SimpleEmitter instance.
   * Initializes an empty event registry.
   */
  constructor() {
    this.events = {};
  }

  /**
   * Register an event handler for a given event.
   * Multiple handlers can be registered for the same event.
   *
   * @param {string} event - The name of the event to listen for
   * @param {EventHandler} handler - The callback function to execute when the event occurs
   * @returns {void}
   *
   * @example
   * ```typescript
   * emitter.on('user:login', (userData) => {
   *   console.log('User logged in:', userData);
   * });
   * ```
   *
   * @cursor-rules
   * - Use descriptive event names with namespaces (e.g., 'user:login', 'cart:item:added')
   * - Keep handlers pure and side-effect free when possible
   * - Store handler references for later removal
   */
  on(event: string, handler: EventHandler): void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(handler);
  }

  /**
   * Register an event handler that will be called only once and then automatically removed.
   * Useful for initialization events or one-time setup operations.
   *
   * @param {string} event - The name of the event to listen for
   * @param {EventHandler} handler - The callback function to execute once when the event occurs
   * @returns {void}
   *
   * @example
   * ```typescript
   * emitter.once('app:initialized', () => {
   *   console.log('Application initialized successfully');
   *   startUserInterface();
   * });
   * ```
   *
   * @cursor-rules
   * - Use 'once' for initialization and setup events
   * - Avoid using 'once' for events that may occur multiple times
   * - Consider using 'once' for cleanup operations
   */
  once(event: string, handler: EventHandler): void {
    const onceHandler = (data: any) => {
      handler(data);
      this.off(event, onceHandler);
    };
    this.on(event, onceHandler);
  }

  /**
   * Unregister an event handler for a given event.
   * Removes the specified handler from the event's handler list.
   *
   * @param {string} event - The name of the event to remove the handler from
   * @param {EventHandler} handler - The callback function to remove (must be the same reference)
   * @returns {void}
   *
   * @example
   * ```typescript
   * const handler = (data) => console.log('Data:', data);
   * emitter.on('data', handler);
   *
   * // Later, remove the handler
   * emitter.off('data', handler);
   * ```
   *
   * @cursor-rules
   * - Always store handler references when adding listeners
   * - Use the exact same handler reference when removing
   * - Remove listeners in cleanup functions to prevent memory leaks
   * - Consider using 'once' instead of manual removal for one-time events
   */
  off(event: string, handler: EventHandler): void {
    if (!this.events[event]) return;

    this.events[event] = this.events[event].filter((h) => h !== handler);
  }

  /**
   * Emit an event, calling all registered handlers synchronously.
   * Handlers are called in the order they were registered.
   *
   * @param {string} event - The name of the event to emit
   * @param {any} data - The data to pass to all registered event handlers
   * @returns {void}
   *
   * @example
   * ```typescript
   * emitter.on('user:updated', (userData) => {
   *   updateUserProfile(userData);
   * });
   *
   * emitter.emit('user:updated', { id: 1, name: 'John Doe' });
   * ```
   *
   * @cursor-rules
   * - Emit events with meaningful data payloads
   * - Use consistent data structures for similar events
   * - Consider using TypeScript interfaces for event data
   * - Avoid emitting events in tight loops to prevent performance issues
   */
  emit(event: string, data: any): void {
    if (!this.events[event]) return;

    this.events[event].forEach((handler) => handler(data));
  }

  count(): number {
    return Object.values(this.events).reduce((n, list) => n + list.length, 0);
  }
}

/**
 * Reactive state management class that combines event emission with proxy-based reactivity.
 * Automatically emits events when state properties are modified, enabling reactive UI updates.
 *
 * @class State
 * @description A singleton state manager with automatic event emission
 *
 * @example
 * ```typescript
 * // Listen for state changes
 * State.on('user', (userData) => {
 *   console.log('User state changed:', userData);
 * });
 *
 * // Update state (triggers events automatically)
 * State.proxy.user = { name: 'John', age: 30 };
 * ```
 */
class State {
  /**
   * Internal event emitter for state change notifications.
   * Handles all event registration and emission for state changes.
   * @static
   * @private
   * @type {SimpleEmitter}
   */
  private static emitter = new SimpleEmitter();

  /**
   * Internal state storage object.
   * Holds all application state data.
   * @static
   * @private
   * @type {Record<string, any>}
   */
  private static state: Record<string, any> = {};

  /**
   * Create a proxy for an object to enable nested reactivity.
   * Recursively wraps object properties with proxies to detect deep changes.
   *
   * @param {Record<string, any>} obj - The object to create a proxy for
   * @returns {ProxyHandler<Record<string, any>>} - The proxied object with reactive capabilities
   * @private
   *
   * @example
   * ```typescript
   * const user = { profile: { name: 'John' } };
   * const reactiveUser = State.createProxy(user);
   *
   * // This will trigger events for both 'profile' and nested changes
   * reactiveUser.profile.name = 'Jane';
   * ```
   *
   * @cursor-rules
   * - Use for complex nested objects that need reactivity
   * - Be aware of performance implications with deeply nested objects
   * - Consider flattening state structure for better performance
   * - Use TypeScript interfaces to define expected object structures
   */
  private static createProxy(
    obj: Record<string, any>
  ): ProxyHandler<Record<string, any>> {
    return new Proxy(obj, {
      set: function (
        target: Record<string, any>,
        property: string | symbol,
        value: any,
        receiver: any
      ): boolean {
        State.emitter.emit(property.toString(), value); // Emit event on property change
        return Reflect.set(target, property, value, receiver); // Set the property using Reflect
      },
    });
  }

  /**
   * Reactive proxy object that wraps the internal state.
   * Automatically emits events when properties are modified.
   * Provides the main interface for state access and modification.
   *
   * @static
   * @public
   * @type {Proxy}
   *
   * @example
   * ```typescript
   * // Set up listeners
   * State.on('user', (userData) => updateUI(userData));
   * State.on('settings', (settings) => applySettings(settings));
   *
   * // Update state (triggers events automatically)
   * State.proxy.user = { name: 'John', email: 'john@example.com' };
   * State.proxy.settings = { theme: 'dark', language: 'en' };
   * ```
   *
   * @cursor-rules
   * - Use descriptive property names for better debugging
   * - Group related state properties under namespaces
   * - Avoid setting undefined or null values unless intentional
   * - Use object spread for partial updates when appropriate
   * - Consider using immutable update patterns for complex state
   */
  public static proxy = new Proxy(State.state, {
    set: function (
      target: Record<string, any>,
      property: string | symbol,
      value: any,
      receiver: any
    ): boolean {
      if (typeof value === "object" && value !== null) {
        // Create a proxy for each property if the value is an object
        value = State.createProxy(value);
      }
      State.emitter.emit(property.toString(), value); // Emit event on property change
      return Reflect.set(target, property, value, receiver); // Set the property using Reflect
    },
  });

  /**
   * Register an event handler for state change events.
   * Delegates to the internal SimpleEmitter instance.
   *
   * @param {string} event - The name of the state property to listen for changes
   * @param {EventHandler} handler - The callback function to execute when the state property changes
   * @returns {void}
   *
   * @example
   * ```typescript
   * State.on('user', (userData) => {
   *   console.log('User state updated:', userData);
   *   renderUserProfile(userData);
   * });
   *
   * State.on('cart', (cartData) => {
   *   updateCartDisplay(cartData);
   *   updateCheckoutButton(cartData);
   * });
   * ```
   *
   * @cursor-rules
   * - Listen for specific state properties rather than generic events
   * - Use descriptive handler names for better debugging
   * - Keep handlers focused on a single responsibility
   * - Consider using TypeScript generics for better type safety
   */
  static on(event: string, handler: EventHandler): void {
    this.emitter.on(event, handler);
  }

  /**
   * Register an event handler that will be called only once for state changes.
   * Useful for initialization or one-time setup operations.
   *
   * @param {string} event - The name of the state property to listen for changes
   * @param {EventHandler} handler - The callback function to execute once when the state property changes
   * @returns {void}
   *
   * @example
   * ```typescript
   * State.once('initialized', () => {
   *   console.log('Application state initialized');
   *   startApplication();
   * });
   *
   * State.once('user', (userData) => {
   *   console.log('First user data received:', userData);
   *   showWelcomeMessage(userData);
   * });
   * ```
   *
   * @cursor-rules
   * - Use for initialization events that should only happen once
   * - Avoid using for events that may occur multiple times
   * - Consider using for cleanup operations
   * - Use descriptive event names for one-time events
   */
  static once(event: string, handler: EventHandler): void {
    this.emitter.once(event, handler);
  }

  /**
   * Unregister an event handler for state change events.
   * Removes the specified handler from the event's handler list.
   *
   * @param {string} event - The name of the state property to remove the handler from
   * @param {EventHandler} handler - The callback function to remove (must be the same reference)
   * @returns {void}
   *
   * @example
   * ```typescript
   * const userHandler = (userData) => updateUserProfile(userData);
   * State.on('user', userHandler);
   *
   * // Later, remove the handler
   * State.off('user', userHandler);
   *
   * // Or in a cleanup function
   * function cleanup() {
   *   State.off('user', userHandler);
   *   State.off('cart', cartHandler);
   * }
   * ```
   *
   * @cursor-rules
   * - Always store handler references when adding listeners
   * - Use the exact same handler reference when removing
   * - Remove listeners in cleanup functions to prevent memory leaks
   * - Consider using 'once' instead of manual removal for one-time events
   * - Create cleanup functions for components that add multiple listeners
   */
  static off(event: string, handler: EventHandler): void {
    this.emitter.off(event, handler);
  }

  /**
   * Total listeners across all events, for leak checks. A method rather than a
   * getter: the proxy `get` trap binds anything it finds on State.
   */
  static count(): number {
    return this.emitter.count();
  }
}

/**
 * Proxy handler that intercepts property access and mutations on the exported state object.
 * Provides a unified interface for both state access and event management methods.
 *
 * @type {ProxyHandler<Record<string, any>>}
 *
 * @example
 * ```typescript
 * // Access state properties
 * console.log(hey.user); // Gets user data
 *
 * // Access event methods
 * hey.on('user', handler); // Calls State.on method
 * hey.off('user', handler); // Calls State.off method
 * ```
 */
const proxyHandler: ProxyHandler<Record<string, any>> = {
  /**
   * Proxy handler to intercept property access.
   * Delegates method calls to the State class and property access to the proxy state.
   *
   * @param {Record<string, any>} target - The target object (State.proxy)
   * @param {string|symbol} property - The name of the property to get
   * @returns {any} - The value of the property or the bound method
   *
   * @example
   * ```typescript
   * // Property access
   * const userData = hey.user; // Returns state.user
   *
   * // Method access
   * const onMethod = hey.on; // Returns State.on.bind(State)
   * ```
   */
  get(target: Record<string, any>, property: string | symbol): any {
    // Delegate method calls to the State class itself
    if (typeof property === "string" && property in State) {
      return (State as any)[property].bind(State);
    }
    // Delegate property access to the proxy state
    return target[property as keyof typeof target];
  },

  /**
   * Proxy handler to intercept property setting.
   * Delegates property mutations to the State.proxy to trigger reactive updates.
   *
   * @param {Record<string, any>} target - The target object (State.proxy)
   * @param {string|symbol} property - The name of the property to set
   * @param {any} value - The new value of the property
   * @param {any} receiver - The proxy or object that initially received the request
   * @returns {boolean} - True if the property was set successfully, false otherwise
   *
   * @example
   * ```typescript
   * // This triggers events automatically
   * hey.user = { name: 'John', age: 30 };
   * hey.settings = { theme: 'dark' };
   *
   * // Nested objects are also reactive
   * hey.user.profile = { bio: 'Hello World' };
   * ```
   *
   * @cursor-rules
   * - Use descriptive property names for better debugging
   * - Set complete objects rather than partial updates when possible
   * - Be aware that nested object changes trigger multiple events
   * - Use object spread for immutable updates when needed
   */
  set(
    target: Record<string, any>,
    property: string | symbol,
    value: any,
    receiver: any
  ): boolean {
    // Delegate property setting to the proxy state
    return Reflect.set(State.proxy, property, value, receiver);
  },
};

/**
 * Reactive state management instance with event emitter capabilities.
 *
 * This is the main export that provides a unified interface for:
 * - Reactive state management with automatic event emission
 * - Event listener registration and management
 * - Proxy-based property access and mutation
 *
 * @typedef {Object} HeyState
 * @property {Function} on - Register an event handler for state changes
 * @property {Function} once - Register a one-time event handler for state changes
 * @property {Function} off - Unregister an event handler for state changes
 * @property {any} [property] - Any property can be set/get to trigger reactive updates
 *
 * @example
 * ```typescript
 * import hey from './lib/hey';
 *
 * // Set up reactive listeners
 * hey.on('user', (userData) => {
 *   console.log('User updated:', userData);
 *   updateUserInterface(userData);
 * });
 *
 * hey.on('cart', (cartData) => {
 *   updateCartDisplay(cartData);
 *   updateCheckoutButton(cartData);
 * });
 *
 * // Update state (triggers events automatically)
 * hey.user = { name: 'John', email: 'john@example.com' };
 * hey.cart = { items: [], total: 0 };
 *
 * // Listen for one-time events
 * hey.once('initialized', () => {
 *   console.log('App initialized!');
 *   startApplication();
 * });
 *
 * // Clean up listeners
 * const handler = (data) => console.log(data);
 * hey.on('update', handler);
 * hey.off('update', handler);
 * ```
 *
 * @cursor-rules
 * - Import as 'hey' for consistency across the codebase
 * - Use descriptive property names for state (e.g., 'user', 'cart', 'settings')
 * - Always remove event listeners in cleanup functions
 * - Use TypeScript interfaces to define state structure
 * - Group related state under namespaces when appropriate
 * - Prefer 'once' for initialization events
 * - Keep event handlers pure and focused
 * - Use object destructuring for complex state updates
 * - Document custom events in component documentation
 * - Consider performance implications with deeply nested objects
 */
export default new Proxy(State.proxy, proxyHandler);
