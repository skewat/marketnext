import { useState, useLayoutEffect, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import { getThemeMode, setThemeMode, type ThemeMode } from '../../features/theme/themeSlice';
import useTheme from "@mui/material/styles/useTheme";
import useMediaQuery from "@mui/material/useMediaQuery";
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import MenuIcon from '@mui/icons-material/Menu';
import marketNextLogo from '../../assets/marketnext-logo.png';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Drawer from "@mui/material/Drawer";
import "@fontsource/exo/400.css";
import { Box } from "@mui/material";

const Header = () => {
  const dispatch = useDispatch();
  const themeMode = useSelector(getThemeMode);
  const theme = useTheme();
  const isLargeScreen = useMediaQuery(theme.breakpoints.up("lg"));
  const [value, setValue] = useState<number>(0);
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  const changeThemeMode = (mode: ThemeMode) => {
    dispatch(setThemeMode(mode));
  };

const renderLogo = () => {
  return (
    <>
      {/* SKEWAT - UPDATED VERSION (using Box for cleaner layout, more flexible sizing) */}
      <Box
        sx={{
          width: { xs: 120, sm: 160 }, // responsive width
          ml: 1,
          mr: 0.5,
        }}
      >
        <img
          src={marketNextLogo}
          alt="MarketNext Logo"
          style={{ width: "100%", height: "auto", objectFit: "contain" }}
        />
      </Box>
    </>
  );
};

  const handleChange = (_e: React.SyntheticEvent, newValue: number) => {
    setValue(newValue);

    if (newValue === 0) {
      navigate('/open-interest');
    } else if (newValue === 1) {
      navigate('/strategy-builder');
    };
  };

  useLayoutEffect(() => {
    if (path === '/open-interest') {
      setValue(0);
    } else if (path === '/strategy-builder') {
      setValue(1);
    };
  }, [path]);

  useEffect(() => {
    if (isLargeScreen) {
      setDrawerOpen(false);
    };
  }, [isLargeScreen]);

  return (
    <AppBar position='fixed' elevation={0} sx={{ backgroundColor: "background.paper", 
      borderBottom: 1, borderBottomColor: "divider", zIndex: (theme) => theme.zIndex.drawer + 2 }}>
      <Toolbar disableGutters>
        <div style={{ flexGrow: 1, flexBasis: 0, display: "inline-flex", alignItems: "center" }}>
          {renderLogo()}
        </div>
        {isLargeScreen && <div style={{ display: "inline-flex", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
          <Tabs value={value} onChange={handleChange}>
            <Tab disableRipple label="Open Interest" sx={{ textTransform: "none", py: 2.9 }} />
            <Tab disableRipple label="Strategy Builder" sx={{ textTransform: "none", py: 2.9 }} />
          </Tabs>
        </div>}
        <div style={{ display: "inline-flex", flexGrow: 1, flexBasis: 0, alignItems: "center", justifyContent: "flex-end" }}>
          <IconButton edge="start" color="inherit" aria-label="menu"
            sx={{ color: "text.primary", mx: 1 }}
            onClick={() => changeThemeMode(themeMode === "light" ? "dark" : "light")}
          >
            {themeMode === "light" ? 
              <DarkModeIcon/> 
                : 
              <LightModeIcon/>
            }
          </IconButton>
          <IconButton
            size="small"
            color="inherit"
            aria-label="menu"
            onClick={() => setDrawerOpen((prevState) => !prevState)}
            sx={{ display: { xs: 'flex', lg: 'none'}, color: "text.primary", mr: 1.5 }}
          >
            {drawerOpen ? <ArrowForwardIcon /> : <MenuIcon />}
          </IconButton>
          <Drawer
            anchor="right"
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
          >
            <div style={{ width: "300px", paddingTop: "65px" }}>
              <Tabs 
                value={value} onChange={handleChange} orientation="vertical" variant="scrollable" sx={{ mt: 2 }}
                TabIndicatorProps={{ sx: { left: 0, width: "5px" } }}
              >
                <Tab disableRipple label="Open Interest" sx={{ textTransform: "none", py: 2.9 }} />
                <Tab disableRipple label="Strategy Builder" sx={{ textTransform: "none", py: 2.9 }} />
              </Tabs>
            </div>
          </Drawer>
        </div>
      </Toolbar>
    </AppBar>
  );
};

export default Header;
