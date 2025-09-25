// src/pages/MenuPage.tsx
import React from "react";
import { useNavigate } from "react-router-dom";

const MenuPage = () => {
  const navigate = useNavigate();

  return (
    <div className="fullscreen-center bg-gray-800">
      <div className="bg-gray-900 p-10 rounded-xl shadow-xl w-full max-w-md flex flex-col items-center space-y-6">
        <h1 className="text-3xl font-bold text-white">Bubble Battle</h1>
        <button
          onClick={() => navigate("/arena")}
          className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition"
        >
          Enter Arena
        </button>
        <button
          onClick={() => alert("Create Your Own Arena coming soon!")}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition"
        >
          Create Your Own Arena
        </button>
      </div>
    </div>
  );
};

export default MenuPage;
