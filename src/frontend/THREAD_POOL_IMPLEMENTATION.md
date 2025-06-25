# Thread Pool Database Implementation

## Overview

Implemented a **Thread Pool with Cancellation** system to replace long timeouts with intelligent query management. This system is optimized for small, frequent queries (100 nodes) with fast cancellation capabilities.

## Key Features

### 🧵 CancellableDatabase Class
- **Thread Pool**: 4 worker threads for concurrent database operations
- **Query Tracking**: Active query monitoring with request IDs
- **Fast Cancellation**: Immediate query cancellation on client disconnect
- **Statistics**: Comprehensive query performance tracking
- **Optimized SQLite**: Connection pooling with performance pragmas

### ⏱️ Timeout Configuration
- **Node Queries**: 8 seconds (reduced from 15s)
- **Edge Queries**: 10 seconds (appropriate for larger result sets)  
- **Bounds Queries**: 5 seconds (simple aggregation)
- **Light Node Queries**: 6 seconds (minimal data transfer)

### 🚦 Request Management
- **Stale Request Detection**: 12 seconds (reduced from 20s)
- **Priority Queue**: Higher priority requests execute first
- **Request Deduplication**: Prevents duplicate queries
- **Database Throttling**: 100ms minimum between requests

## Implementation Details

### Backend Changes

#### 1. CancellableDatabase Manager
```python
class CancellableDatabase:
    def __init__(self, max_workers: int = 4):
        self.executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="db_worker"
        )
        self.active_queries: dict = {}
        self.query_stats = {...}
```

#### 2. Cancellation Decorator
```python
@with_cancellation(timeout=8.0)
async def get_nodes_in_box(..., _request_id: str = None, _timeout: float = None):
    # Function automatically gets cancellation support
```

#### 3. Updated API Endpoints
- `/api/nodes/box` - Spatial node queries with cancellation
- `/api/edges/batch` - Edge batch queries with cancellation  
- `/api/bounds` - Data bounds with cancellation
- `/api/nodes/box/light` - Light nodes with cancellation

#### 4. Debug Endpoints
- `/api/debug/queries` - View active queries and statistics
- `/api/debug/cancel-queries` - Emergency cancel all queries
- `/api/debug/cancel-query/{id}` - Cancel specific query

### Frontend Changes

#### 1. Reduced Timeouts
```typescript
// fetchNodes.ts
timeout: 8000,  // Node queries (was 15000)
timeout: 5000,  // Bounds queries (was 10000) 
timeout: 6000,  // Light nodes (was 10000)
timeout: 10000, // Edge queries (appropriate for larger data)
```

#### 2. RequestManager Updates
```typescript
// Stale request detection reduced to 12 seconds
if (requestAge > 12000) {
  // Cancel old requests faster
}
```

## Performance Benefits

### 🚀 Speed Improvements
- **Faster Cancellation**: Thread pool allows immediate query termination
- **Better Concurrency**: 4 concurrent database connections vs sequential
- **Reduced Wait Times**: 8s timeout vs 15s for small queries
- **Optimized SQLite**: WAL mode, memory temp tables, reduced sync

### 📊 Monitoring & Debugging
- **Real-time Statistics**: Query success/failure/timeout rates
- **Active Query Tracking**: See exactly what's running
- **Emergency Controls**: Cancel all queries if system gets stuck
- **Request ID Logging**: Track individual queries through system

### 🔧 Database Optimizations
```sql
PRAGMA journal_mode = WAL;     -- Better concurrency
PRAGMA synchronous = NORMAL;   -- Faster writes  
PRAGMA temp_store = memory;    -- Use memory for temp tables
PRAGMA busy_timeout = 5000;    -- 5 second busy timeout
```

## Usage Examples

### Test Query Performance
```bash
# Test node query
curl "http://localhost:8000/api/nodes/box?minX=-2&maxX=2&minY=-2&maxY=2&limit=100"

# Check query statistics  
curl "http://localhost:8000/api/debug/queries"

# Emergency cancel all queries
curl -X POST "http://localhost:8000/api/debug/cancel-queries"
```

### Monitor System Health
```bash
# View active queries and thread pool status
curl "http://localhost:8000/api/debug/queries" | jq '.'

# Results show:
{
  "active_queries": {},
  "stats": {
    "total_queries": 3,
    "cancelled_queries": 0, 
    "timeout_queries": 0,
    "successful_queries": 3
  },
  "executor_info": {
    "max_workers": 4,
    "active_threads": 1
  }
}
```

## Migration Benefits

### Before (Long Timeouts)
- ❌ 15-second timeouts for 100 nodes
- ❌ No cancellation capability  
- ❌ Sequential database connections
- ❌ No query monitoring
- ❌ Stuck requests block system

### After (Thread Pool)
- ✅ 8-second timeouts for 100 nodes
- ✅ Immediate cancellation on client disconnect
- ✅ 4 concurrent database connections
- ✅ Real-time query monitoring
- ✅ Emergency reset capabilities

## Error Handling

### Timeout Responses
```json
{
  "detail": "Database query timeout (8s). Try reducing query complexity.",
  "status_code": 408
}
```

### Cancellation Responses  
```json
{
  "detail": "Request cancelled", 
  "status_code": 499
}
```

## Configuration

### Backend Settings
```python
# Thread pool size (adjust based on CPU cores)
db_manager = CancellableDatabase(max_workers=4)

# Timeout per query type
@with_cancellation(timeout=8.0)  # Nodes
@with_cancellation(timeout=10.0) # Edges  
@with_cancellation(timeout=5.0)  # Bounds
```

### Frontend Settings
```typescript
// RequestManager stale detection
if (requestAge > 12000) { /* cancel */ }

// API timeouts per endpoint
timeout: 8000,  // Most queries
timeout: 5000,  // Simple queries
timeout: 10000, // Complex queries
```

This implementation provides a robust, scalable solution for handling database queries with proper cancellation support, optimized for the specific use case of querying 100 nodes at a time. 