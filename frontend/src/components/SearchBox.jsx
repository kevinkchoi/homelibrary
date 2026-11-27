import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./SearchBox.css";

export default function SearchBox() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  function handleSubmit(e) {
    e.preventDefault();
    if (q.trim()) {
      navigate(`/search?q=${encodeURIComponent(q.trim())}`);
    }
  }

  return (
    <form className="search-box" onSubmit={handleSubmit}>
      <input
        type="search"
        placeholder="제목, 저자, 출판사, 번역자, ISBN 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <button className="btn" type="submit">
        검색
      </button>
    </form>
  );
}
