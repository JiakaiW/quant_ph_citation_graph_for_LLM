import React, { useState, useEffect } from 'react';
import { ClusterInfo, ClusterManager } from '../utils/clustering/ClusterManager';
import './ClusterPanel.css';

interface ClusterPanelProps {
  isVisible: boolean;
  onClose: () => void;
}

const ClusterPanel: React.FC<ClusterPanelProps> = ({ isVisible, onClose }) => {
  const [clusters, setClusters] = useState<ClusterInfo[]>([]);
  const [visibleClusters, setVisibleClusters] = useState<Set<number>>(new Set());
  const clusterManager = ClusterManager.getInstance();

  useEffect(() => {
    if (!isVisible) return;

    const handleUpdate = () => {
      setClusters(clusterManager.getClusters());
      setVisibleClusters(clusterManager.getVisibleClusterIds());
    };

    clusterManager.onGlobalChange(handleUpdate);
    handleUpdate(); // Initial load

    return () => {
      clusterManager.removeGlobalChangeCallback(handleUpdate);
    };
  }, [isVisible, clusterManager]);

  const handleClusterToggle = (clusterId: number) => {
    clusterManager.toggleCluster(clusterId);
  };

  if (!isVisible) return null;

  return (
    <div className="cluster-panel-container">
      <div className="cluster-panel-header">
        <h2>Clusters</h2>
        <button onClick={onClose} className="close-button">&times;</button>
      </div>
      <div className="cluster-list">
        {clusters.map((cluster) => (
          <div key={cluster.id} className="cluster-item">
            <label>
              <input
                type="checkbox"
                checked={visibleClusters.has(cluster.id)}
                onChange={() => handleClusterToggle(cluster.id)}
              />
              <span
                className="cluster-color-box"
                style={{ backgroundColor: cluster.color }}
              ></span>
              {cluster.name}
            </label>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ClusterPanel; 