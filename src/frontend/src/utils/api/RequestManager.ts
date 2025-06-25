/**
 * 🚦 Request Manager
 * 
 * Advanced request management system to prevent API backlog and database contention.
 * Features:
 * - Request queuing with priority
 * - Aggressive cancellation of stale requests
 * - Database-aware throttling
 * - Request deduplication
 */

interface QueuedRequest {
  id: string;
  priority: number; // Higher = more important
  timestamp: number;
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  signal: AbortSignal;
  type: 'nodes' | 'edges' | 'bounds' | 'stats';
}

export class RequestManager {
  private static instance: RequestManager;
  private requestQueue: QueuedRequest[] = [];
  private activeRequests: Map<string, AbortController> = new Map();
  private isProcessing: boolean = false;
  private maxConcurrentRequests: number = 2; // Limit concurrent DB queries
  private requestCounter: number = 0;
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 100; // Minimum 100ms between requests

  private constructor() {}

  public static getInstance(): RequestManager {
    if (!RequestManager.instance) {
      RequestManager.instance = new RequestManager();
    }
    return RequestManager.instance;
  }

  /**
   * Queue a request with priority and automatic deduplication
   */
  public async queueRequest<T>(
    type: 'nodes' | 'edges' | 'bounds' | 'stats',
    requestKey: string,
    priority: number,
    requestFn: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    // Cancel any existing request with the same key
    this.cancelRequest(requestKey);

    // Create abort controller for this request
    const controller = new AbortController();
    this.activeRequests.set(requestKey, controller);

    return new Promise<T>((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        id: requestKey,
        priority,
        timestamp: Date.now(),
        execute: () => requestFn(controller.signal),
        resolve,
        reject,
        signal: controller.signal,
        type
      };

      // Add to queue and sort by priority (highest first)
      this.requestQueue.push(queuedRequest);
      this.requestQueue.sort((a, b) => b.priority - a.priority);

      // Start processing if not already
      this.processQueue();
    });
  }

  /**
   * Cancel a specific request
   */
  public cancelRequest(requestKey: string): void {
    // Cancel active request
    const controller = this.activeRequests.get(requestKey);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(requestKey);
    }

    // Remove from queue
    this.requestQueue = this.requestQueue.filter(req => req.id !== requestKey);
  }

  /**
   * Cancel all requests of a specific type
   */
  public cancelRequestsByType(type: 'nodes' | 'edges' | 'bounds' | 'stats'): void {
    // Cancel active requests
    for (const [key, controller] of this.activeRequests.entries()) {
      const queuedReq = this.requestQueue.find(req => req.id === key);
      if (queuedReq && queuedReq.type === type) {
        controller.abort();
        this.activeRequests.delete(key);
      }
    }

    // Remove from queue
    this.requestQueue = this.requestQueue.filter(req => req.type !== type);
  }

  /**
   * Cancel all pending requests (emergency stop)
   */
  public cancelAllRequests(): void {
    console.log(`🚫 RequestManager: Cancelling ${this.activeRequests.size} active and ${this.requestQueue.length} queued requests`);
    
    // Cancel all active requests
    for (const controller of this.activeRequests.values()) {
      controller.abort();
    }
    this.activeRequests.clear();

    // Reject all queued requests
    this.requestQueue.forEach(req => {
      req.reject(new Error('Request cancelled'));
    });
    this.requestQueue = [];
  }

  /**
   * Get current queue status
   */
  public getStatus(): {
    queueLength: number;
    activeRequests: number;
    isProcessing: boolean;
    oldestRequest: number | null;
  } {
    const oldestRequest = this.requestQueue.length > 0 
      ? Date.now() - this.requestQueue[this.requestQueue.length - 1].timestamp 
      : null;

    return {
      queueLength: this.requestQueue.length,
      activeRequests: this.activeRequests.size,
      isProcessing: this.isProcessing,
      oldestRequest
    };
  }

  /**
   * Process the request queue with throttling
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    // Limit concurrent requests to prevent database overload
    if (this.activeRequests.size >= this.maxConcurrentRequests) {
      console.log(`🚦 RequestManager: Max concurrent requests reached (${this.maxConcurrentRequests}), waiting...`);
      return;
    }

    this.isProcessing = true;

    try {
      // Throttle requests to prevent database overload
      const timeSinceLastRequest = Date.now() - this.lastRequestTime;
      if (timeSinceLastRequest < this.minRequestInterval) {
        await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
      }

      // Get highest priority request
      const request = this.requestQueue.shift();
      if (!request) {
        this.isProcessing = false;
        return;
      }

      // Check if request is stale (older than 12 seconds - reduced for thread pool)
      const requestAge = Date.now() - request.timestamp;
      if (requestAge > 12000) {
        console.log(`🗑️ RequestManager: Discarding stale request ${request.id} (${requestAge}ms old)`);
        request.reject(new Error('Request too old'));
        this.isProcessing = false;
        this.processQueue(); // Continue with next request
        return;
      }

      // Check if request was cancelled
      if (request.signal.aborted) {
        console.log(`🚫 RequestManager: Request ${request.id} was cancelled`);
        request.reject(new Error('Request cancelled'));
        this.isProcessing = false;
        this.processQueue(); // Continue with next request
        return;
      }

      this.lastRequestTime = Date.now();
      console.log(`🚀 RequestManager: Executing ${request.type} request ${request.id} (priority: ${request.priority})`);

      try {
        const result = await request.execute();
        request.resolve(result);
        console.log(`✅ RequestManager: Request ${request.id} completed successfully`);
      } catch (error) {
        if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('cancelled'))) {
          console.log(`🚫 RequestManager: Request ${request.id} was cancelled during execution`);
        } else {
          console.error(`❌ RequestManager: Request ${request.id} failed:`, error);
        }
        request.reject(error);
      } finally {
        // Clean up
        this.activeRequests.delete(request.id);
      }

    } finally {
      this.isProcessing = false;
      
      // Continue processing queue
      setTimeout(() => this.processQueue(), 10);
    }
  }

  /**
   * Generate unique request key for deduplication
   */
  public static generateRequestKey(type: string, params: any): string {
    const paramString = JSON.stringify(params, Object.keys(params).sort());
    return `${type}_${btoa(paramString).replace(/[^a-zA-Z0-9]/g, '')}`;
  }

  /**
   * Calculate request priority based on type and urgency
   */
  public static calculatePriority(
    type: 'nodes' | 'edges' | 'bounds' | 'stats',
    isUserInitiated: boolean = false,
    lodLevel: number = 1
  ): number {
    let basePriority = 0;
    
    switch (type) {
      case 'bounds': basePriority = 100; break; // Highest priority
      case 'nodes': basePriority = 80; break;
      case 'edges': basePriority = 60; break;
      case 'stats': basePriority = 20; break;   // Lowest priority
    }
    
    // User-initiated requests get higher priority
    if (isUserInitiated) {
      basePriority += 20;
    }
    
    // Lower LOD (more detailed) gets higher priority
    basePriority += (3 - lodLevel) * 10;
    
    return basePriority;
  }

  /**
   * Emergency cleanup for stuck states
   */
  public emergencyReset(): void {
    console.warn('🚨 RequestManager: Emergency reset triggered');
    this.cancelAllRequests();
    this.isProcessing = false;
    this.lastRequestTime = 0;
  }
} 