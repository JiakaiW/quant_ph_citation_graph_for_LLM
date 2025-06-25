import { useState, useEffect, useCallback } from 'react';
import { getThemeConfig, getThemePalette, type ThemeColorPalette } from '../utils/config/ConfigLoader';

/**
 * 🎨 Simplified Theme Hook
 * 
 * Automatically follows system preferences and refreshes when system theme changes.
 * No manual theme switching - purely system-driven.
 */
export const useTheme = () => {
  const [resolvedMode, setResolvedMode] = useState<'light' | 'dark'>('light');
  const [themePalette, setThemePalette] = useState<ThemeColorPalette>(getThemePalette('light'));

  /**
   * Get current system theme preference
   */
  const getSystemTheme = useCallback((): 'light' | 'dark' => {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches 
      ? 'dark' 
      : 'light';
  }, []);

  /**
   * Update theme based on system preference
   */
  const updateTheme = useCallback((forceRefresh = false) => {
    const systemTheme = getSystemTheme();
    const newPalette = getThemePalette(systemTheme);
    
    setResolvedMode(systemTheme);
    setThemePalette(newPalette);
    
    // Update document class
    document.documentElement.classList.remove('theme-light', 'theme-dark');
    document.documentElement.classList.add(`theme-${systemTheme}`);
    
    console.log(`🎨 Theme updated to: ${systemTheme}${forceRefresh ? ' (with refresh)' : ''}`);
    
    // If this is a system theme change (not initial load), refresh the page
    // to ensure Sigma.js picks up the new colors properly
    if (forceRefresh) {
      console.log('🔄 Auto-refreshing page for theme change...');
      setTimeout(() => {
        window.location.reload();
      }, 100); // Small delay to let the console message show
    }
    
    return systemTheme;
  }, [getSystemTheme]);

  /**
   * Apply theme colors as CSS custom properties
   */
  const applyThemeToCSS = useCallback((palette: ThemeColorPalette) => {
    const root = document.documentElement;
    
    // Canvas/background colors
    root.style.setProperty('--theme-canvas-bg', palette.canvasBackground);
    root.style.setProperty('--theme-body-bg', palette.bodyBackground);
    
    // Panel backgrounds
    root.style.setProperty('--theme-panel-bg', palette.panelBackground);
    root.style.setProperty('--theme-panel-secondary-bg', palette.panelBackgroundSecondary);
    root.style.setProperty('--theme-header-bg', palette.headerBackground);
    
    // Text colors
    root.style.setProperty('--theme-text-primary', palette.textPrimary);
    root.style.setProperty('--theme-text-secondary', palette.textSecondary);
    root.style.setProperty('--theme-text-muted', palette.textMuted);
    root.style.setProperty('--theme-text-inverse', palette.textInverse);
    
    // Border colors
    root.style.setProperty('--theme-border-primary', palette.borderPrimary);
    root.style.setProperty('--theme-border-secondary', palette.borderSecondary);
    root.style.setProperty('--theme-border-accent', palette.borderAccent);
    
    // Graph edge colors
    root.style.setProperty('--theme-edge-color', palette.edgeColor);
    
    // Status colors
    root.style.setProperty('--theme-success', palette.success);
    root.style.setProperty('--theme-warning', palette.warning);
    root.style.setProperty('--theme-error', palette.error);
    root.style.setProperty('--theme-info', palette.info);
    
    console.log(`🎨 Applied ${resolvedMode} theme CSS variables`);
  }, [resolvedMode]);

  /**
   * Initialize theme on component mount
   */
  useEffect(() => {
    // Set initial theme without refresh
    updateTheme(false);
    console.log('🎨 Theme initialized from system preference');
  }, [updateTheme]);

  /**
   * Listen for system theme changes and auto-refresh
   */
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleSystemThemeChange = () => {
      console.log('🎨 System theme changed, updating and refreshing...');
      updateTheme(true); // This will refresh the page
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
  }, [updateTheme]);

  /**
   * Apply CSS variables when theme palette changes
   */
  useEffect(() => {
    applyThemeToCSS(themePalette);
  }, [themePalette, applyThemeToCSS]);

  return {
    // Current theme state
    resolvedMode,
    themePalette,
    
    // Utility functions
    isLight: resolvedMode === 'light',
    isDark: resolvedMode === 'dark',
  };
}; 