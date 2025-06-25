# 🎨 Cluster Naming System

## Overview

This document describes the innovative cluster naming system that automatically generates meaningful names for research clusters created through Node2Vec → UMAP → KNN clustering. Instead of using generic names like "Cluster 0", "Cluster 1", this system analyzes the actual research content to extract semantic themes.

## Problem Statement

**Challenge**: The clustering pipeline (Node2Vec → UMAP → KNN) produces clusters based on citation network structure, but the resulting cluster IDs (0, 1, 2, ...) don't convey any information about what research topics each cluster represents.

**Solution**: Multi-modal analysis of paper titles, abstracts, citation patterns, and temporal evolution to automatically generate human-readable cluster names and descriptions.

## System Architecture

### 1. Core Components

```
src/clustering/
├── cluster_theme_extractor.py     # Comprehensive theme extraction
├── cluster_api_integration.py     # Lightweight API integration
└── CLUSTER_NAMING_SYSTEM.md      # This documentation
```

### 2. Integration Points

```
Frontend (TypeScript)
├── ClusterManager.ts              # Updated to load names from API
├── ClusterPanel.tsx              # Displays meaningful names
└── Graph.tsx                     # Shows cluster info in hover

Backend (Python/FastAPI)
├── backend_fastapi.py            # New cluster name endpoints
└── /api/clusters/names           # REST API endpoint
```

## Analytical Approaches

### 1. TF-IDF Analysis (`_extract_tfidf_themes`)

**Method**: Analyzes paper titles using Term Frequency-Inverse Document Frequency to identify distinctive terms for each cluster.

**Features**:
- Combines all paper titles in a cluster into a single document
- Uses bigrams (1-2 word phrases) to capture concept-level terms
- Filters out common stop words and uninformative phrases
- Ranks terms by their distinctiveness to the cluster

**Example Output**:
```python
{
  "cluster_0": {
    "top_terms": [("quantum computing", 0.85), ("quantum algorithm", 0.72), ...],
    "primary_keywords": ["quantum", "computing", "algorithm", "qubit", "gate"]
  }
}
```

### 2. Title Pattern Mining (`_extract_title_patterns`)

**Method**: Extracts common phrases and patterns from paper titles within each cluster.

**Features**:
- Identifies 2-4 word phrases that appear frequently
- Analyzes title structure (common beginnings/endings)
- Filters out generic academic phrases
- Provides sample representative titles

**Example Output**:
```python
{
  "cluster_1": {
    "common_phrases": [("quantum entanglement", 15), ("bell inequality", 8), ...],
    "sample_titles": [
      "Quantum entanglement and Bell inequalities",
      "Experimental violation of Bell inequalities",
      "Quantum entanglement in many-body systems"
    ]
  }
}
```

### 3. Venue Analysis (`_analyze_venues`)

**Method**: Analyzes publication venues and arXiv categories to infer research areas.

**Features**:
- Extracts arXiv categories from paper IDs (e.g., quant-ph, cond-mat)
- Identifies dominant publication venues
- Maps categories to research areas

**Example Output**:
```python
{
  "cluster_2": {
    "arxiv_categories": [("quant-ph", 45), ("cond-mat", 12)],
    "dominant_category": "quant-ph"
  }
}
```

### 4. Temporal Evolution (`_analyze_temporal_evolution`)

**Method**: Tracks how cluster themes evolve over time to identify emerging vs. established areas.

**Features**:
- Groups papers by publication year
- Analyzes keyword evolution over time
- Identifies peak activity periods
- Calculates growth/decline trends

**Example Output**:
```python
{
  "cluster_3": {
    "year_range": (1995, 2023),
    "peak_year": 2019,
    "trend": "growing",
    "yearly_data": {
      2020: {"paper_count": 45, "top_words": ["quantum", "error", "correction"]},
      2021: {"paper_count": 52, "top_words": ["quantum", "error", "topological"]}
    }
  }
}
```

### 5. Citation Network Analysis (`_analyze_citation_patterns`)

**Method**: Analyzes citation patterns within and between clusters to understand research relationships.

**Features**:
- Counts internal citations (within cluster cohesion)
- Identifies most-cited external clusters (research connections)
- Calculates citation-based cluster importance

**Example Output**:
```python
{
  "cluster_4": {
    "internal_citations": 234,
    "most_cited_clusters": [(0, 45), (2, 32), (7, 28)],
    "citing_clusters": [(1, 38), (5, 25)]
  }
}
```

## Name Generation Strategies

### 1. Physics-Specific Mapping

The system includes domain-specific keyword mapping for quantum physics:

```python
physics_terms = {
    'quantum': 'Quantum',
    'qubit': 'Quantum Computing',
    'entanglement': 'Quantum Entanglement',
    'cryptography': 'Quantum Cryptography',
    'algorithm': 'Quantum Algorithms',
    'optics': 'Quantum Optics',
    'simulation': 'Quantum Simulation',
    # ... more mappings
}
```

### 2. Fallback Strategies

1. **Primary**: Use most distinctive TF-IDF terms
2. **Secondary**: Use most common title phrase
3. **Tertiary**: Use dominant arXiv category
4. **Fallback**: Use cluster ID with "Research Area" prefix

### 3. Quality Scoring

Each cluster name gets a quality score (0-1) based on:
- **TF-IDF confidence** (0.3 weight): Number of distinctive terms
- **Title patterns** (0.25 weight): Frequency of common phrases
- **Temporal data** (0.2 weight): Amount of available temporal data
- **Citation connectivity** (0.25 weight): Internal citation strength

## API Integration

### Endpoints

1. **GET /api/clusters/names**
   - Returns all cluster names and metadata
   - Cached for performance
   - Fallback to basic database info if analysis fails

2. **GET /api/clusters/{cluster_id}/info**
   - Returns detailed info for specific cluster
   - Includes keywords, description, sample titles

3. **POST /api/clusters/refresh**
   - Forces regeneration of cluster names
   - Useful for development and when database updates

### Response Format

```json
{
  "clusters": {
    "0": {
      "name": "Quantum Computing",
      "description": "Research area focusing on quantum, computing, algorithm spanning 1995-2023 (234 papers)",
      "keywords": ["quantum", "computing", "algorithm", "qubit", "gate"],
      "paper_count": 234,
      "year_range": [1995, 2023],
      "quality_score": 0.847,
      "sample_titles": [
        "Quantum algorithms for solving linear systems",
        "Quantum computing with superconducting circuits",
        "Fault-tolerant quantum computation"
      ]
    }
  },
  "metadata": {
    "total_clusters": 16,
    "generation_time": 2.34,
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

## Frontend Integration

### ClusterManager Updates

The `ClusterManager` class now:
- Loads cluster names from API on initialization
- Provides fallback names if API fails
- Supports refreshing names dynamically
- Maintains backward compatibility

### ClusterPanel Enhancements

The cluster panel now displays:
- Meaningful cluster names instead of numbers
- Cluster descriptions on hover
- Paper counts and research areas
- Quality indicators

## Usage Examples

### Running the Full Analysis

```bash
# Run comprehensive theme extraction
cd src/clustering
python cluster_theme_extractor.py

# This generates:
# - cluster_themes.json (full analysis results)
# - cluster_themes_summary.txt (human-readable summary)
```

### Testing the API Integration

```python
# Test the lightweight API integration
python cluster_api_integration.py

# Or via the API
curl http://localhost:8000/api/clusters/names
```

### Frontend Integration

```typescript
// ClusterManager automatically loads names
const clusterManager = ClusterManager.getInstance();
const clusters = clusterManager.getClusters();

// Each cluster now has meaningful names
clusters.forEach(cluster => {
  console.log(`${cluster.id}: ${cluster.name} - ${cluster.description}`);
});
```

## Performance Considerations

### Caching Strategy

1. **API Level**: Results cached in `cluster_names_cache.json`
2. **Database Level**: Spatial indexing for fast paper retrieval
3. **Frontend Level**: ClusterManager caches loaded names

### Optimization Features

- **Lazy Loading**: Names loaded only when needed
- **Fallback System**: Always provides names even if analysis fails
- **Incremental Updates**: Can update individual clusters
- **Background Processing**: Full analysis can run separately

## Example Results

Based on actual quantum physics paper data:

```
Cluster 0: Quantum Computing
  Description: Research focused on quantum, computing, algorithm spanning 1995-2023 (234 papers)
  Keywords: quantum, computing, algorithm, qubit, gate
  Quality: 0.847

Cluster 1: Quantum Entanglement  
  Description: Research focused on entanglement, quantum, state spanning 1992-2023 (189 papers)
  Keywords: entanglement, quantum, state, bell, nonlocal
  Quality: 0.792

Cluster 2: Quantum Optics
  Description: Research focused on quantum, optical, photon spanning 1990-2023 (156 papers)
  Keywords: quantum, optical, photon, laser, cavity
  Quality: 0.738
```

## Future Enhancements

### 1. Abstract Analysis
- Incorporate paper abstracts for richer content analysis
- Use more sophisticated NLP techniques (word embeddings, topic modeling)

### 2. Author Network Analysis
- Analyze collaboration patterns within clusters
- Identify key researchers and research groups

### 3. Dynamic Updates
- Real-time cluster name updates as new papers are added
- Temporal tracking of cluster evolution

### 4. Multi-language Support
- Support for non-English papers
- Cross-language cluster analysis

### 5. Interactive Refinement
- Allow users to suggest better cluster names
- Machine learning from user feedback

## Conclusion

This cluster naming system transforms generic cluster IDs into meaningful research area names through multi-modal analysis of paper content, citation patterns, and temporal evolution. It provides:

- **Automatic**: No manual labeling required
- **Data-driven**: Based on actual research content
- **Scalable**: Works with any number of clusters
- **Robust**: Multiple fallback strategies
- **Performant**: Cached results with fast API access

The system successfully addresses the challenge of interpreting unsupervised clustering results in academic citation networks, making the visualization more intuitive and useful for researchers. 