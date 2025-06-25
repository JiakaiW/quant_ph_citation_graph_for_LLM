import React, { useState, useEffect } from 'react';
import { ClusterManager, ClusterInfo, ClusterStats } from '../utils/clustering/ClusterManager';
import { ColorManager } from '../utils/shapes/NodeShapeManager';
import { QualityFilter, QualityFilterSettings } from '../utils/filtering/QualityFilter';
import './ClusterPanel.css';

interface ClusterPanelProps {
  isVisible: boolean;
  onClose: () => void;
}

export const ClusterPanel: React.FC<ClusterPanelProps> = ({ isVisible, onClose }) => {
  const [clusters, setClusters] = useState<ClusterInfo[]>([]);
  const [stats, setStats] = useState<ClusterStats>({ totalClusters: 0, visibleClusters: 0, totalNodes: 0, visibleNodes: 0 });
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'id' | 'name' | 'nodeCount'>('id');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [qualitySettings, setQualitySettings] = useState<QualityFilterSettings>({ enabled: false, minDegree: 5 });

  const clusterManager = ClusterManager.getInstance();
  const qualityFilter = QualityFilter.getInstance();

  // Get color dot for cluster (no more shape icons needed)
  const getColorDot = (): string => {
    return '●'; // Simple circle for all clusters
  };

  // Update clusters and stats
  const updateData = () => {
    setClusters(clusterManager.getClusters());
    setStats(clusterManager.getStats());
    setQualitySettings(qualityFilter.getSettings());
  };

  useEffect(() => {
    // Initial load
    updateData();

    // Listen for cluster changes
    const handleGlobalChange = () => {
      updateData();
    };

    clusterManager.onGlobalChange(handleGlobalChange);

    // Listen for quality filter changes
    const handleQualityChange = () => {
      updateData();
    };

    qualityFilter.onChange(handleQualityChange);

    // Cleanup
    return () => {
      clusterManager.removeGlobalChangeCallback(handleGlobalChange);
      qualityFilter.removeChangeCallback(handleQualityChange);
    };
  }, []);

  // Filter and sort clusters
  const filteredClusters = clusters
    .filter(cluster => 
      cluster.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cluster.id.toString().includes(searchTerm)
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'nodeCount':
          return b.nodeCount - a.nodeCount;
        case 'id':
        default:
          return a.id - b.id;
      }
    });

  const handleToggleCluster = (clusterId: number) => {
    clusterManager.toggleCluster(clusterId);
  };

  const handleShowAll = () => {
    clusterManager.showAllClusters();
  };

  const handleHideAll = () => {
    clusterManager.hideAllClusters();
  };

  const handleQualityToggle = () => {
    qualityFilter.toggle();
  };

  const handleMinDegreeChange = (newMinDegree: number) => {
    qualityFilter.setMinDegree(newMinDegree);
  };

  if (!isVisible) return null;

  return (
    <div className="cluster-panel">
      <div className="cluster-panel-header">
        <div className="cluster-panel-title">
          <h3>🎨 Cluster Control</h3>
          <button 
            className="collapse-btn"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "Expand panel" : "Collapse panel"}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
        </div>
        <button className="close-btn" onClick={onClose} title="Close panel">×</button>
      </div>

      {!isCollapsed && (
        <>
          {/* Stats Section */}
          <div className="cluster-stats">
            <div className="stat-item">
              <span className="stat-label">Clusters:</span>
              <span className="stat-value">{stats.visibleClusters}/{stats.totalClusters}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Nodes:</span>
              <span className="stat-value">{stats.visibleNodes.toLocaleString()}/{stats.totalNodes.toLocaleString()}</span>
            </div>
          </div>

          {/* Quality Filter Section */}
          <div className="quality-filter-section">
            <div className="quality-filter-header">
              <span className="quality-filter-title">🎯 Quality Filter</span>
              <button
                className={`quality-toggle-btn ${qualitySettings.enabled ? 'enabled' : 'disabled'}`}
                onClick={handleQualityToggle}
                title={qualitySettings.enabled ? 'Disable quality filter' : 'Enable quality filter'}
              >
                {qualitySettings.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="quality-filter-controls">
              <div className="quality-filter-setting">
                <label htmlFor="min-degree-input" className="quality-label">
                  Min Citations: {qualitySettings.minDegree}
                </label>
                <input
                  id="min-degree-input"
                  type="range"
                  min="0"
                  max="50"
                  value={qualitySettings.minDegree}
                  onChange={(e) => handleMinDegreeChange(parseInt(e.target.value))}
                  className="quality-slider"
                  disabled={!qualitySettings.enabled}
                />
              </div>
              <div className="quality-description">
                {qualitySettings.enabled 
                  ? `Hiding papers with < ${qualitySettings.minDegree} citations`
                  : 'All papers shown (no quality filter)'
                }
              </div>
            </div>
          </div>

          {/* Controls Section */}
          <div className="cluster-controls">
            <div className="control-row">
              <button 
                className="control-btn show-all"
                onClick={handleShowAll}
                title="Show all clusters"
              >
                Show All
              </button>
              <button 
                className="control-btn hide-all"
                onClick={handleHideAll}
                title="Hide all clusters"
              >
                Hide All
              </button>
            </div>

            <div className="search-sort-row">
              <input
                type="text"
                className="search-input"
                placeholder="Search clusters..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <select
                className="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'id' | 'name' | 'nodeCount')}
              >
                <option value="id">Sort by ID</option>
                <option value="name">Sort by Name</option>
                <option value="nodeCount">Sort by Size</option>
              </select>
            </div>
          </div>

          {/* Clusters List */}
          <div className="clusters-list">
            {filteredClusters.map(cluster => (
              <div 
                key={cluster.id} 
                className={`cluster-item ${cluster.visible ? 'visible' : 'hidden'}`}
              >
                <div className="cluster-info">
                  <div className="cluster-visual">
                    <div 
                      className="cluster-color" 
                      style={{ backgroundColor: cluster.color }}
                      title={`Cluster ${cluster.id} color`}
                    ></div>
                    <div 
                      className="cluster-shape"
                      style={{ color: cluster.color }}
                      title="All clusters use small circles"
                    >
                      {getColorDot()}
                    </div>
                  </div>
                  <div className="cluster-details">
                    <div className="cluster-name">{cluster.name}</div>
                    <div className="cluster-meta">
                      ID: {cluster.id} • {cluster.nodeCount.toLocaleString()} nodes • Small circles
                    </div>
                  </div>
                </div>
                <button
                  className={`toggle-btn ${cluster.visible ? 'visible' : 'hidden'}`}
                  onClick={() => handleToggleCluster(cluster.id)}
                  title={cluster.visible ? 'Hide cluster' : 'Show cluster'}
                >
                  {cluster.visible ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
            ))}
          </div>

          {filteredClusters.length === 0 && (
            <div className="no-results">
              No clusters found matching "{searchTerm}"
            </div>
          )}
        </>
      )}
    </div>
  );
}; 