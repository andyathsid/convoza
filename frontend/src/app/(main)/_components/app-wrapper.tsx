"use client";

import AsideBar from "./aside-bar";

interface Props {
  children: React.ReactNode;
}

const AppWrapper = ({ children }: Props) => {
  return (
    <div className="h-full flex">
      <AsideBar />
      <main className="flex flex-col h-full overflow-hidden flex-1 min-w-0">{children}</main>
    </div>
  );
};



export default AppWrapper;
