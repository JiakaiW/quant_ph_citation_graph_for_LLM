# Citation Graph Acyclicity Analysis

This directory contains tools to analyze how "acyclic" your citation graph is using three complementary methods suggested by ChatGPT.

## 🎯 Purpose

Citation graphs should theoretically be Directed Acyclic Graphs (DAGs) since papers cite older papers. However, in practice, some cycles can occur due to:
- Simultaneous submissions citing each other
- Data errors in publication dates
- Preprints vs. final publications
- Cross-citations in series of papers

## 🔬 Three Analysis Methods

### Method 1: Topological Sort Test
**Question**: *Is the graph a DAG at all?*
- Quick O(V+E) test using NetworkX
- Returns: ✓ Perfect DAG or ✗ Contains cycles

### Method 2: SCC Analysis (Recommended)
**Question**: *Where are the cycles and how big are they?*  
- Most precise and informative method
- Uses Tarjan's algorithm to find Strongly Connected Components
- Reports: % nodes in cycles, largest cycle size, cycle distribution
- **Key insight**: Citation graphs typically have >99% singleton SCCs

### Method 3: Feedback Edge Analysis  
**Question**: *How many citations violate chronological order?*
- Requires publication year data
- Counts "backward" citations (newer paper → older paper)
- Heuristic measure of cycle-causing edges

## 📊 Expected Results for Citation Graphs

**Typical healthy citation graph:**
```
Total SCCs        : 70,789   (one per paper)  
Non-trivial SCCs  : 27       (<0.04%)
Largest SCC size  : 4         
Backward citations: 0.1%     
```

**→ >99.96% of nodes are in singleton SCCs ⇒ "almost acyclic"**

## 🚀 Usage

### Install Dependencies
```bash
pip install -r requirements.txt
```

### Quick Test (5% sample)
```bash
cd src/acyclicity
python acyclicity_analyzer.py
# Enter: 0.05
```

### Full Analysis (All 1.3M citations)
```bash
python acyclicity_analyzer.py  
# Enter: 1.0
# ⚠️ Will take several minutes
```

### Test Individual Components
```bash
# Test database connection
python graph_loader.py

# Run specific analysis
python -c "
from graph_loader import CitationGraphLoader
from acyclicity_analyzer import AcyclicityAnalyzer

loader = CitationGraphLoader()
G, papers_df = loader.load_citation_graph(sample_fraction=0.01)
analyzer = AcyclicityAnalyzer(G, papers_df)
analyzer.method_2_scc_analysis()
"
```

## 📋 Output Files

After running the analysis, you'll get:

- **`acyclicity_report.txt`** - Comprehensive text report with recommendations
- **`scc_distribution.png`** - Visualization of cycle sizes  
- **`sample_graph_summary.txt`** - Basic graph statistics

## 🎯 Interpreting Results

### For Algorithm Design:

| Condition | Recommendation |
|-----------|----------------|
| **Largest SCC ≤ 5** and **backward ratio < 0.1%** | Safe to treat as DAG; spanning forest is sufficient |
| **Few large SCCs** and **backward ratio < 1%** | Consider SCC condensation for robustness |
| **Many large SCCs** or **backward ratio > 10%** | Must use SCC-aware algorithms |

### Assessment Categories:

- **✅ HIGHLY ACYCLIC**: >99.9% nodes not in cycles
- **✅ MOSTLY ACYCLIC**: >99% nodes not in cycles  
- **⚠️ SOMEWHAT ACYCLIC**: >95% nodes not in cycles
- **❌ SIGNIFICANTLY CYCLIC**: <95% nodes not in cycles

## 📈 Performance

| Graph Size | Method 1 | Method 2 | Method 3 |
|------------|----------|----------|----------|
| 10K nodes  | <0.1s    | <1s      | <5s      |
| 100K nodes | <1s      | <10s     | <30s     |
| 1M+ edges  | <5s      | <60s     | <300s    |

Method 2 (SCC analysis) is the most informative and reasonably fast even for large graphs.

## 🔧 Configuration

Edit the database path in `graph_loader.py` if needed:
```python
def __init__(self, db_path: str = "../../data/arxiv_papers.db"):
```

## 🧪 Validation

The tools include built-in validation:
- Database connectivity checks
- Sample data verification  
- Computation time monitoring
- Result sanity checks 