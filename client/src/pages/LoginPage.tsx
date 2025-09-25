import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = () => {
    if (username && password) {
      navigate("/menu");
    } else {
      alert("Please enter username and password");
    }
  };

  return (
    <div className="w-screen h-screen bg-gradient-to-r from-purple-500 via-pink-500 to-red-500
                    grid place-items-center">
      <div className="bg-white rounded-xl shadow-xl p-10 w-full max-w-sm flex flex-col items-center space-y-6">
        <h1 className="text-3xl font-bold text-gray-800 text-center">Bubble Battle Login</h1>

        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          className="w-full px-4 py-2 rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-400"
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full px-4 py-2 rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-400"
        />

        <button
          onClick={handleLogin}
          className="w-full bg-purple-600 text-white py-2 rounded hover:bg-purple-700 transition"
        >
          Sign In
        </button>

        <div className="flex items-center w-full space-x-2">
          <hr className="flex-1 border-gray-300" />
          <span className="text-gray-500 text-sm">or</span>
          <hr className="flex-1 border-gray-300" />
        </div>

        <button
          onClick={() => alert("Google Sign-In placeholder")}
          className="w-full bg-red-500 text-white py-2 rounded hover:bg-red-600 transition flex items-center justify-center space-x-2"
        >
          <img src="/images/google-icon.png" alt="Google" className="w-5 h-5" />
          <span>Sign in with Google</span>
        </button>
      </div>
    </div>
  );
};

export default LoginPage;
