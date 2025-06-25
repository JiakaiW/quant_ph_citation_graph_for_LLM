# 🎯 Frontend Structure Overview

## Core Architecture

The frontend uses a **clean, object-oriented architecture** with the main GraphManager coordinating specialized utility classes.

```
src/frontend/
├── backend_fastapi.py          # FastAPI backend with search endpoints
├── config.yaml                 # Centralized configuration
├── package.json                # Node.js dependencies
├── tsconfig.json              # TypeScript configuration
├── vite.config.ts             # Vite build configuration
├── index.html                 # Entry point
└── src/
    ├── main.tsx               # React app entry
    ├── App.tsx                # Main app component with theme
    ├── index.css              # Global styles with theme variables
    ├── components/            # React components
    │   ├── Graph.tsx          # Main graph visualization
    │   ├── ClusterPanel.tsx   # Cluster filtering interface
    │   ├── SearchInterface.tsx # Search UI
    │   ├── SearchContainer.tsx # Search system container
    │   ├── ThemeToggle.tsx    # Theme switching
    │   └── *.css              # Component styles
    ├── hooks/                 # React hooks
    │   ├── useTheme.ts        # Theme management
    │   └── useViewport.ts     # Viewport utilities
    ├── api/                   # API client
    │   ├── fetchNodes.ts      # Graph data fetching
    │   └── searchApi.ts       # Search API client
    └── utils/                 # Core utilities
        ├── GraphManager.ts    # Main graph orchestrator
        ├── config/            # Configuration system
        ├── clustering/        # Cluster management
        ├── filtering/         # Quality filtering
        ├── interactions/      # Click highlighting
        ├── nodes/             # Node priority management
        ├── shapes/            # Color management
        ├── search/            # Search system
        └── api/               # Request management
```

## Key Features

### 🎨 **Theme System**
- Automatic light/dark mode detection
- CSS custom properties for consistent theming
- All components use theme variables

### 🔍 **Search System**
- Real-time paper search with relevance scoring
- Integration with graph visualization
- Automatic node loading and highlighting

### 🎯 **Quality Filtering**
- Dynamic filtering by citation count
- Real-time graph updates
- Preserves user interaction

### 🎨 **Cluster Management**
- Intelligent cluster naming based on influential papers
- Color-coded visualization
- Toggle visibility per cluster

### 🖱️ **Interactions**
- Click highlighting with neighbor detection
- Smooth panning and zooming
- Responsive drag detection

## Configuration

All settings are centralized in `config.yaml`:
- Visual appearance (colors, sizes)
- Performance tuning (batch sizes, timeouts)
- Level-of-detail thresholds
- Memory management
- Theme colors

## Clean Architecture Principles

1. **Single Responsibility**: Each class has one clear purpose
2. **Dependency Injection**: Components receive dependencies via constructor
3. **Configuration-Driven**: Behavior controlled via config file
4. **Type Safety**: Full TypeScript coverage
5. **Modular Design**: Easy to extend and modify

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start backend
python backend_fastapi.py

# Build for production
npm run build
```

## Documentation

- `docs/archive/` - Development documentation and guides
- `README.md` - Main project documentation
- Component files include inline documentation 