import React from 'react';

// Simplified props for the new Tree-First architecture
interface ConsolidatedPanelProps {
  stats: {
    nodeCount: number;
    edgeCount: number;
    isLoading: boolean;
    loadingStatus?: {
      state: 'idle' | 'loading_batches' | 'removing_nodes' | 'max_nodes_reached';
      message?: string;
      batchesLoaded?: number;
      maxNodesReached?: boolean;
      removedNodesCount?: number;
    };
    connectivity: string;
    hasMore: boolean;
    lodLevel?: string;
    datasetBounds?: {
      x: { min: number; max: number };
      y: { min: number; max: number };
    };
    viewportRange?: {
      x: { min: number; max: number };
      y: { min: number; max: number };
    };
  };
  onRefresh: () => void;
  onCameraReset: () => void;
  onToggleClusters: () => void;
  onToggleSearch: () => void;
}

// --- Style Objects ---
const panelStyle: React.CSSProperties = {
  position: 'absolute', top: '10px', left: '10px', background: 'rgba(0,0,0,0.8)',
  color: 'white', padding: '12px', borderRadius: '8px',
  fontFamily: 'system-ui, -apple-system, sans-serif', zIndex: 1000,
  minWidth: '280px', border: '1px solid rgba(255,255,255,0.2)',
};
const headerStyle: React.CSSProperties = {
  fontSize: '14px', fontWeight: 'bold', color: '#4CAF50',
  borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', marginBottom: '8px',
};
const loadingSectionStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', marginBottom: '8px', fontSize: '12px',
};
const spinnerStyle: React.CSSProperties = {
  width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)',
  borderTop: '2px solid white', borderRadius: '50%', marginRight: '8px',
  animation: 'spin 1s linear infinite',
};
const statsSectionStyle: React.CSSProperties = { marginBottom: '8px' };
const statsHeaderStyle: React.CSSProperties = { fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' };
const statsItemStyle: React.CSSProperties = {
  fontSize: '11px', display: 'flex', justifyContent: 'space-between', padding: '2px 0',
};
const statsItemLabelStyle: React.CSSProperties = { color: '#aaa' };
const buttonsSectionStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' };
const buttonStyle: React.CSSProperties = {
  background: '#333', color: 'white', border: '1px solid #555', padding: '6px',
  borderRadius: '4px', cursor: 'pointer', fontSize: '11px',
};

export const ConsolidatedPanel: React.FC<ConsolidatedPanelProps> = ({
  stats,
  onRefresh,
  onCameraReset,
  onToggleClusters,
  onToggleSearch
}) => {
  // Helper function to get loading status message and icon
  const getLoadingStatus = () => {
    if (!stats.loadingStatus) return null;

    let icon = '🔄';
    let message = stats.loadingStatus.message || '';

    switch (stats.loadingStatus.state) {
      case 'loading_batches':
        icon = '📦';
        if (stats.loadingStatus.batchesLoaded) {
          message += ` (Batch ${stats.loadingStatus.batchesLoaded})`;
        }
        break;
      case 'removing_nodes':
        icon = '🗑️';
        break;
      case 'max_nodes_reached':
        icon = '⚠️';
        break;
      case 'idle':
        icon = '✅';
        break;
    }

    return { icon, message };
  };

  const loadingStatus = getLoadingStatus();

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        🧠 Control Panel
      </div>

      {loadingStatus && (
        <div style={loadingSectionStyle}>
          <span style={{ marginRight: '8px' }}>{loadingStatus.icon}</span>
          <span>{loadingStatus.message}</span>
        </div>
      )}

      <div style={statsSectionStyle}>
        <div style={statsHeaderStyle}>📊 Graph Status</div>
        <div style={statsItemStyle}><span style={statsItemLabelStyle}>Nodes:</span> {stats.nodeCount}</div>
        <div style={statsItemStyle}><span style={statsItemLabelStyle}>Edges:</span> {stats.edgeCount}</div>
        <div style={statsItemStyle}><span style={statsItemLabelStyle}>Connectivity:</span> {stats.connectivity}</div>
        <div style={statsItemStyle}><span style={statsItemLabelStyle}>More on zoom:</span> {stats.hasMore ? 'Yes' : 'No'}</div>
        <div style={statsItemStyle}><span style={statsItemLabelStyle}>View Level:</span> {stats.lodLevel || 'unknown'}</div>
      </div>

      {stats.datasetBounds && (
        <div style={statsSectionStyle}>
          <div style={statsHeaderStyle}>📏 Dataset Range</div>
          <div style={statsItemStyle}>
            <span style={statsItemLabelStyle}>X Range:</span>
            {stats.datasetBounds.x.min.toFixed(2)} to {stats.datasetBounds.x.max.toFixed(2)}
          </div>
          <div style={statsItemStyle}>
            <span style={statsItemLabelStyle}>Y Range:</span>
            {stats.datasetBounds.y.min.toFixed(2)} to {stats.datasetBounds.y.max.toFixed(2)}
          </div>
        </div>
      )}

      {stats.viewportRange && (
        <div style={statsSectionStyle}>
          <div style={statsHeaderStyle}>🔍 Viewport Range</div>
          <div style={statsItemStyle}>
            <span style={statsItemLabelStyle}>X Range:</span>
            {stats.viewportRange.x.min.toFixed(2)} to {stats.viewportRange.x.max.toFixed(2)}
          </div>
          <div style={statsItemStyle}>
            <span style={statsItemLabelStyle}>Y Range:</span>
            {stats.viewportRange.y.min.toFixed(2)} to {stats.viewportRange.y.max.toFixed(2)}
          </div>
        </div>
      )}

      <div style={buttonsSectionStyle}>
        <button style={buttonStyle} onClick={onRefresh}>🔄 Refresh</button>
        <button style={buttonStyle} onClick={onCameraReset}>🎥 Reset Camera</button>
        <button style={buttonStyle} onClick={onToggleClusters}>🎨 Clusters</button>
        <button style={buttonStyle} onClick={onToggleSearch}>🔍 Search</button>
      </div>

      {/* Keyframes need to be injected globally, e.g., in index.css */}
    </div>
  );
}; 