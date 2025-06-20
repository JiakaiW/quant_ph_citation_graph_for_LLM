#!/usr/bin/env python3
"""
Enhanced script to examine the arxiv_papers database.
Usage: 
    python step1_examine_db.py <start_row> <end_row>           # View rows
    python step1_examine_db.py --histogram                     # Generate histogram
    python step1_examine_db.py --histogram --save filename.png # Save histogram
"""

import sqlite3
import sys
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime
import argparse
import numpy as np

def connect_db(db_path="arxiv_papers.db"):
    """Connect to the database and return connection."""
    try:
        conn = sqlite3.connect(db_path)
        return conn
    except sqlite3.Error as e:
        print(f"Database error: {e}")
        sys.exit(1)

def get_db_stats(conn):
    """Get basic database statistics."""
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM arxiv_papers")
    total_count = cursor.fetchone()[0]
    
    if total_count > 0:
        cursor.execute("SELECT MIN(submitted_date), MAX(submitted_date) FROM arxiv_papers")
        min_date, max_date = cursor.fetchone()
        return total_count, min_date, max_date
    else:
        return total_count, None, None

def view_rows(conn, start_row, end_row):
    """View specific rows from the database."""
    cursor = conn.cursor()
    
    # Get total count
    total_count, _, _ = get_db_stats(conn)
    print(f"Total papers in database: {total_count}")
    
    if total_count == 0:
        print("Database is empty. Run step1_get_arxiv_ids.py first.")
        return
    
    if start_row > total_count:
        print(f"Error: Start row ({start_row}) is greater than total rows ({total_count})")
        return
    
    # Query rows - check if title column exists
    try:
        cursor.execute("""
            SELECT arxiv_id, submitted_date, title, first_seen_date, analysis_status
            FROM arxiv_papers 
            ORDER BY first_seen_date DESC
            LIMIT ? OFFSET ?
        """, (end_row - start_row + 1, start_row - 1))
        
        rows = cursor.fetchall()
        
        print(f"\nShowing rows {start_row} to {min(end_row, total_count)}:")
        print(f"{'Row':<5} {'arXiv ID':<15} {'Submitted':<12} {'Title':<30} {'First Seen':<20} {'Status':<10}")
        print("-" * 100)
        
        for i, row in enumerate(rows, start=start_row):
            arxiv_id, submitted_date, title, first_seen_date, analysis_status = row
            first_seen_display = first_seen_date[:19] if first_seen_date else "N/A"
            title_display = (title[:27] + "...") if len(title) > 30 else title
            print(f"{i:<5} {arxiv_id:<15} {submitted_date:<12} {title_display:<30} {first_seen_display:<20} {analysis_status:<10}")
            
    except sqlite3.OperationalError:
        # Fallback for older schema without title column
        cursor.execute("""
            SELECT arxiv_id, submitted_date, first_seen_date, analysis_status
            FROM arxiv_papers 
            ORDER BY first_seen_date DESC
            LIMIT ? OFFSET ?
        """, (end_row - start_row + 1, start_row - 1))
        
        rows = cursor.fetchall()
        
        print(f"\nShowing rows {start_row} to {min(end_row, total_count)}:")
        print(f"{'Row':<5} {'arXiv ID':<15} {'Submitted':<12} {'First Seen':<20} {'Status':<10}")
        print("-" * 70)
        
        for i, row in enumerate(rows, start=start_row):
            arxiv_id, submitted_date, first_seen_date, analysis_status = row
            first_seen_display = first_seen_date[:19] if first_seen_date else "N/A"
            print(f"{i:<5} {arxiv_id:<15} {submitted_date:<12} {first_seen_display:<20} {analysis_status:<10}")

def generate_histogram(conn, save_path=None):
    """Generate and display/save histogram of submission dates."""
    print("Generating histogram of paper submission dates...")
    
    # Get database stats
    total_count, min_date, max_date = get_db_stats(conn)
    
    if total_count == 0:
        print("Database is empty. Run step1_get_arxiv_ids.py first.")
        return
    
    print(f"Total papers: {total_count}")
    print(f"Date range: {min_date} to {max_date}")
    
    # Load data into pandas
    query = "SELECT submitted_date FROM arxiv_papers"
    df = pd.read_sql_query(query, conn)
    
    # Convert to datetime
    df['submitted_date'] = pd.to_datetime(df['submitted_date'])
    df['year'] = df['submitted_date'].dt.year
    df['year_month'] = df['submitted_date'].dt.to_period('M')
    
    # Prepare data for Prophet forecasting
    monthly_counts = df['year_month'].value_counts().sort_index()
    
    # Convert period to datetime for Prophet
    date_list = [period.to_timestamp() for period in monthly_counts.index]
    paper_counts = monthly_counts.values
    
    # Create Prophet DataFrame
    prophet_df = pd.DataFrame({"ds": date_list, "y": paper_counts})
    
    # Fit Prophet model
    try:
        from prophet import Prophet
        print("Fitting Prophet model for 2-year forecast...")
        
        prophet_df['y'] = np.log(prophet_df['y'])
        recent_dates = prophet_df[prophet_df['ds'] > '2023-11-01']['ds']
        m = Prophet(
            yearly_seasonality=True,
            changepoint_prior_scale=0.5, 
            seasonality_mode='additive'  # works better on log
        )
        m.changepoints = recent_dates

        m.fit(prophet_df)        
        # Create future dataframe for 2 years (24 months)
        future = m.make_future_dataframe(periods=24, freq='ME')
        forecast = m.predict(future)
        
        # Extract forecast components
        forecast_dates = forecast['ds'].tail(24)  # Last 24 months (future)
        forecast_values = np.exp(forecast['yhat'].tail(24))
        forecast_lower = np.exp(forecast['yhat_lower'].tail(24))
        forecast_upper = np.exp(forecast['yhat_upper'].tail(24))
        
        print(f"✓ Forecast generated for {len(forecast_dates)} future months")
        
    except ImportError:
        print("⚠️  Prophet not available. Install with: pip install prophet")
        forecast_dates, forecast_values, forecast_lower, forecast_upper = [], [], [], []
    except Exception as e:
        print(f"⚠️  Prophet forecasting failed: {e}")
        forecast_dates, forecast_values, forecast_lower, forecast_upper = [], [], [], []
    
    # Set up the plot style
    plt.style.use('default')
    sns.set_palette("husl")
    
    # Create figure with subplots (1 row, 2 columns)
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 6))
    fig.suptitle('arXiv Quant-Ph Papers Submission Analysis', fontsize=16, fontweight='bold')
    
    # 1. Monthly histogram with log scale and forecast
    x_positions = range(len(monthly_counts))
    ax1.bar(x_positions, monthly_counts.values, alpha=0.7, color='skyblue', edgecolor='navy', label='Historical')
    
    # Add forecast if available
    if len(forecast_dates) > 0:
        # Convert forecast dates to positions
        forecast_start_pos = len(monthly_counts)
        forecast_x_positions = range(forecast_start_pos, forecast_start_pos + len(forecast_values))
        
        # Plot forecast line
        ax1.plot(forecast_x_positions, forecast_values, color='red', linewidth=2, 
                label='Forecast (2 years)', marker='o', markersize=3)
        
        # Plot confidence interval
        ax1.fill_between(forecast_x_positions, forecast_lower, forecast_upper, 
                        alpha=0.3, color='red', label='95% Confidence')
        
        # Add vertical line to separate historical and forecast
        ax1.axvline(x=forecast_start_pos - 0.5, color='black', linestyle='--', alpha=0.7, 
                   label='Forecast Start')
    
    ax1.set_title('Papers per Month (Log Scale) with 2-Year Forecast')
    ax1.set_xlabel('Months (chronological)')
    ax1.set_ylabel('Number of Papers (Log Scale)')
    ax1.set_yscale('log')
    ax1.grid(True, alpha=0.3, which='both')
    ax1.minorticks_on()
    ax1.legend()
    
    # Set x-axis labels - show every 12th month (yearly labels)
    tick_positions = [i for i in range(0, len(monthly_counts), 12)]
    tick_labels = [str(monthly_counts.index[i]) for i in tick_positions]
    ax1.set_xticks(tick_positions)
    ax1.set_xticklabels(tick_labels, rotation=45)
    
    # 2. Cumulative growth with forecast
    df_sorted = df.sort_values('submitted_date')
    df_sorted['cumulative'] = range(1, len(df_sorted) + 1)
    
    # Prepare cumulative data for Prophet forecasting
    cumulative_dates = df_sorted['submitted_date'].values
    cumulative_counts = df_sorted['cumulative'].values
    
    # Create Prophet DataFrame for cumulative data
    cumulative_prophet_df = pd.DataFrame({"ds": cumulative_dates, "y": cumulative_counts})
    
    # Fit Prophet model for cumulative data
    try:
        print("Fitting Prophet model for cumulative growth forecast...")
        
        # Use log scale for cumulative data too
        cumulative_prophet_df['y'] = np.log(cumulative_prophet_df['y'])
        
        m_cumulative = Prophet(
            yearly_seasonality=True,
            changepoint_prior_scale=0.5,
            seasonality_mode='additive'
        )
        # Use same changepoints as monthly data
        m_cumulative.changepoints = recent_dates
        
        m_cumulative.fit(cumulative_prophet_df)
        
        # Create future dataframe for cumulative forecast
        # We need to create future dates that extend beyond the last historical date
        last_date = cumulative_dates[-1]
        future_dates = pd.date_range(start=last_date, periods=25, freq='ME')[1:]  # Skip the first (last_date)
        future_cumulative = m_cumulative.make_future_dataframe(periods=24, freq='ME')
        forecast_cumulative = m_cumulative.predict(future_cumulative)
        
        # Extract forecast components for cumulative data
        forecast_cumulative_dates = forecast_cumulative['ds'].tail(24)
        forecast_cumulative_values = np.exp(forecast_cumulative['yhat'].tail(24))
        forecast_cumulative_lower = np.exp(forecast_cumulative['yhat_lower'].tail(24))
        forecast_cumulative_upper = np.exp(forecast_cumulative['yhat_upper'].tail(24))
        
        print(f"✓ Cumulative forecast generated for {len(forecast_cumulative_dates)} future months")
        
    except Exception as e:
        print(f"⚠️  Cumulative Prophet forecasting failed: {e}")
        forecast_cumulative_dates, forecast_cumulative_values, forecast_cumulative_lower, forecast_cumulative_upper = [], [], [], []
    
    # Plot historical cumulative data
    ax2.plot(df_sorted['submitted_date'], df_sorted['cumulative'], linewidth=2, color='green', label='Historical')
    
    # Add cumulative forecast if available
    if len(forecast_cumulative_dates) > 0:
        # Plot forecast line
        ax2.plot(forecast_cumulative_dates, forecast_cumulative_values, color='red', linewidth=2, 
                label='Forecast (2 years)', marker='o', markersize=3)
        
        # Plot confidence interval
        ax2.fill_between(forecast_cumulative_dates, forecast_cumulative_lower, forecast_cumulative_upper, 
                        alpha=0.3, color='red', label='95% Confidence')
        
        # Add vertical line to separate historical and forecast
        ax2.axvline(x=last_date, color='black', linestyle='--', alpha=0.7, 
                   label='Forecast Start')
    
    ax2.set_title('Cumulative Papers Over Time with 2-Year Forecast')
    ax2.set_xlabel('Date')
    ax2.set_ylabel('Cumulative Count')
    ax2.grid(True, alpha=0.3)
    ax2.legend()
    
    # Rotate x-axis labels for better readability
    ax2.tick_params(axis='x', rotation=45)
    
    plt.tight_layout()
    
    # Print some statistics
    print(f"\nStatistics:")
    print(f"Mean papers per month: {monthly_counts.mean():.1f}")
    print(f"Peak month: {monthly_counts.idxmax()} ({monthly_counts.max()} papers)")
    print(f"Min papers in a month: {monthly_counts.min()} papers")
    print(f"Total months with papers: {len(monthly_counts)}")
    
    # Print forecast statistics if available
    if len(forecast_values) > 0:
        print(f"\nForecast Statistics (2 years):")
        print(f"Predicted mean papers per month: {forecast_values.mean():.1f}")
        print(f"Predicted peak month: {forecast_dates.iloc[forecast_values.argmax()].strftime('%Y-%m')} ({forecast_values.max():.1f} papers)")
        print(f"Predicted total papers in 2 years: {forecast_values.sum():.0f}")
        
        # Print cumulative forecast statistics
        if len(forecast_cumulative_values) > 0:
            print(f"\nCumulative Forecast Statistics (2 years):")
            print(f"Current total papers: {total_count:,}")
            predicted_total = forecast_cumulative_values.iloc[-1] if hasattr(forecast_cumulative_values, 'iloc') else forecast_cumulative_values[-1]
            print(f"Predicted total papers in 2 years: {predicted_total:,.0f}")
            print(f"Predicted growth: +{predicted_total - total_count:,.0f} papers")
            print(f"Predicted growth rate: {((predicted_total / total_count) - 1) * 100:.1f}%")
    
    # Save or show
    if save_path:
        plt.savefig(save_path, dpi=300, bbox_inches='tight')
        print(f"Histogram saved to {save_path}")
    else:
        plt.show()

def main():
    parser = argparse.ArgumentParser(description='Examine arXiv papers database')
    parser.add_argument('--histogram', action='store_true', help='Generate histogram of submission dates')
    parser.add_argument('--save', type=str, help='Save histogram to file (use with --histogram)')
    parser.add_argument('start_row', nargs='?', type=int, help='Start row for viewing')
    parser.add_argument('end_row', nargs='?', type=int, help='End row for viewing')
    
    args = parser.parse_args()
    
    # Connect to database
    conn = connect_db()
    
    try:
        if args.histogram:
            # Generate histogram
            generate_histogram(conn, args.save)
        elif args.start_row is not None and args.end_row is not None:
            # View rows
            if args.start_row < 1 or args.end_row < 1:
                print("Error: Row numbers must be positive integers (1-indexed).")
                sys.exit(1)
            if args.start_row > args.end_row:
                print("Error: Start row must be less than or equal to end row.")
                sys.exit(1)
            view_rows(conn, args.start_row, args.end_row)
        else:
            # Show usage
            print("Usage:")
            print("  python step1_examine_db.py <start_row> <end_row>           # View rows")
            print("  python step1_examine_db.py --histogram                     # Generate histogram")
            print("  python step1_examine_db.py --histogram --save filename.png # Save histogram")
            sys.exit(1)
            
    finally:
        conn.close()

if __name__ == "__main__":
    main() 