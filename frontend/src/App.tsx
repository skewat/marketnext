import { Routes, Route, Navigate } from "react-router-dom";
import Layout from './components/Layout';
import OpenInterest from './components/OpenInterest';
import StrategyBuilder from "./components/StrategyBuilder";
import Scheduler from "./components/Scheduler";
import Login from "./components/Auth/Login";
import Positions from "./components/Positions";
import TrendAnalyses from "./components/TrendAnalyses";
import ToastContextProvider from "./contexts/ToastContextProvider";
import Toast from "./components/Common/Toast";

function App() {
  return (
    <ToastContextProvider>
      <Toast />
      <Routes>
        <Route path="/*" element={<Layout />}>
          <Route index element={<Navigate to="/open-interest" />} />
          <Route path="open-interest" element={<OpenInterest />} />
          <Route path="strategy-builder" element={<StrategyBuilder />} />
          <Route path="scheduler" element={<Scheduler />} />
          <Route path="positions" element={<Positions />} />
          <Route path="trends" element={<TrendAnalyses />} />
          <Route path="login" element={<Login />} />
        </Route>
      </Routes>
    </ToastContextProvider>
  );
};

export default App;
