import { ReactNode } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@/lib/AuthContext";

interface ProtectedRouteProps {
    children: ReactNode;
}

export function ProtectedRoute({
    children,
}: ProtectedRouteProps) {
    const { token } = useAuth();

    if (!token) {
        return <Redirect to="/login" />;
    }

    return <>{children}</>;
}