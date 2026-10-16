import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AdvancedMarker,
  APIProvider,
  InfoWindow,
  Map,
  Pin,
} from '@vis.gl/react-google-maps';
import type { MapMouseEvent } from '@vis.gl/react-google-maps';
import type { LatLng, NagarSetuComplaint } from '../types/maps';
import { openGoogleMapsDirections } from '../utils/navigation';
import '../styles/nagarsetu-maps.css';

export type NagarSetuMapProps = {
  complaints?: NagarSetuComplaint[];
  center?: LatLng;
  zoom?: number;
  height?: string;
  mapId?: string;
  onComplaintSelect?: (complaint: NagarSetuComplaint) => void;
  onMapLocationSelect?: (position: LatLng) => void;
  enableLocationPicker?: boolean;
  selectedPosition?: LatLng | null;
  detailUrlPrefix?: string;
  showNavigationButton?: boolean;
};

// Default Municipal Coordinates: Nashik City Center
export const DEFAULT_NAGARSETU_CENTER: LatLng = { lat: 20.0059, lng: 73.7898 };

function getStatusPinColors(status?: string, priority?: string): { background: string; borderColor: string; glyphColor: string } {
  if (priority === 'Critical') {
    return { background: '#dc2626', borderColor: '#991b1b', glyphColor: '#ffffff' };
  }
  switch (status) {
    case 'Resolved':
      return { background: '#059669', borderColor: '#064e3b', glyphColor: '#ffffff' };
    case 'In Progress':
    case 'Accepted':
    case 'On the Way':
      return { background: '#d97706', borderColor: '#78350f', glyphColor: '#ffffff' };
    case 'Staff Assigned':
    case 'Department Assigned':
      return { background: '#0284c7', borderColor: '#075985', glyphColor: '#ffffff' };
    case 'Verified':
    case 'Approved':
      return { background: '#2563eb', borderColor: '#1e40af', glyphColor: '#ffffff' };
    case 'Reopened':
      return { background: '#ea580c', borderColor: '#7c2d12', glyphColor: '#ffffff' };
    default:
      return { background: '#64748b', borderColor: '#334155', glyphColor: '#ffffff' };
  }
}

function MarkerWithInfo({
  complaint,
  onSelect,
  detailUrlPrefix,
  showNavigationButton = true,
}: {
  complaint: NagarSetuComplaint;
  onSelect?: (complaint: NagarSetuComplaint) => void;
  detailUrlPrefix?: string;
  showNavigationButton?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const position = useMemo(
    () => ({ lat: Number(complaint.latitude), lng: Number(complaint.longitude) }),
    [complaint.latitude, complaint.longitude]
  );

  const handleClick = () => {
    setOpen((prev) => !prev);
    onSelect?.(complaint);
  };

  const pinColors = getStatusPinColors(complaint.status, complaint.priority);

  return (
    <>
      <AdvancedMarker
        position={position}
        title={complaint.title || complaint.category}
        onClick={handleClick}
      >
        <Pin
          background={pinColors.background}
          borderColor={pinColors.borderColor}
          glyphColor={pinColors.glyphColor}
          scale={1.05}
        />
      </AdvancedMarker>

      {open && (
        <InfoWindow
          position={position}
          onClose={() => setOpen(false)}
          maxWidth={340}
        >
          <div className="nagarsetu-map-popup font-sans">
            <div className="nagarsetu-map-popup__header">
              <span className="font-mono font-bold text-emerald-800 text-xs">
                {complaint.complaintNumber || `ID: ${complaint.id.slice(0, 8)}`}
              </span>
              <span
                style={{
                  backgroundColor: `${pinColors.background}18`,
                  color: pinColors.background,
                  borderColor: pinColors.borderColor
                }}
                className="border font-bold text-[10px] uppercase tracking-wide"
              >
                {complaint.status || 'Reported'}
              </span>
            </div>

            <h4 className="font-extrabold text-gray-900 text-sm">{complaint.title || complaint.category}</h4>
            {complaint.description && (
              <p className="text-xs text-gray-600 line-clamp-2">{complaint.description}</p>
            )}

            <div className="nagarsetu-map-popup__meta">
              <span>Category: <strong>{complaint.category}</strong></span>
              {complaint.priority && (
                <span>Priority: <strong style={{ color: pinColors.background }}>{complaint.priority}</strong></span>
              )}
              {complaint.department_name && (
                <span>Dept: <strong>{complaint.department_name}</strong></span>
              )}
            </div>

            <div className="nagarsetu-map-popup__actions">
              {detailUrlPrefix ? (
                <Link
                  to={`${detailUrlPrefix}/${complaint.id}`}
                  className="nagarsetu-map-popup__action-primary"
                >
                  View Details →
                </Link>
              ) : onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(complaint)}
                  className="nagarsetu-map-popup__action-primary"
                >
                  Inspect Issue
                </button>
              ) : null}

              {showNavigationButton && (
                <button
                  type="button"
                  onClick={() => openGoogleMapsDirections(position)}
                  className="nagarsetu-map-popup__action-secondary"
                  title="Navigate via Google Maps"
                >
                  🧭 Navigate
                </button>
              )}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

function SelectedLocationMarker({ position }: { position: LatLng }) {
  return (
    <AdvancedMarker position={position} title="Selected complaint location">
      <Pin background="#059669" borderColor="#064e3b" glyphColor="#ffffff" scale={1.2} />
    </AdvancedMarker>
  );
}

export function NagarSetuMap({
  complaints = [],
  center = DEFAULT_NAGARSETU_CENTER,
  zoom = 13,
  height = '520px',
  mapId = import.meta.env.VITE_GOOGLE_MAP_ID || 'DEMO_MAP_ID',
  onComplaintSelect,
  onMapLocationSelect,
  enableLocationPicker = false,
  selectedPosition,
  detailUrlPrefix,
  showNavigationButton = true,
}: NagarSetuMapProps) {
  const apiKey =
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ||
    (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_API_KEY as string) ||
    '';

  const validComplaints = useMemo(
    () =>
      complaints.filter(
        (c) =>
          c &&
          c.latitude != null &&
          c.longitude != null &&
          !isNaN(Number(c.latitude)) &&
          !isNaN(Number(c.longitude)) &&
          Number(c.latitude) !== 0 &&
          Number(c.longitude) !== 0
      ),
    [complaints]
  );

  if (!apiKey || apiKey.trim() === '') {
    return (
      <div className="nagarsetu-map-fallback" style={{ height }}>
        <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center font-bold text-xl">
          🗺️
        </div>
        <strong className="text-gray-900 font-extrabold text-sm font-outfit">Google Maps is not configured.</strong>
        <span className="text-xs text-gray-500 max-w-sm">
          Set <code className="bg-gray-100 text-emerald-800 px-1.5 py-0.5 rounded font-mono text-[11px]">VITE_GOOGLE_MAPS_API_KEY</code> in your environment to view the interactive Google Maps layer.
        </span>
      </div>
    );
  }

  const handleMapClick = (event: MapMouseEvent) => {
    if (!enableLocationPicker || !event.detail.latLng) return;
    onMapLocationSelect?.({
      lat: Number(event.detail.latLng.lat),
      lng: Number(event.detail.latLng.lng),
    });
  };

  return (
    <APIProvider apiKey={apiKey}>
      <div className="nagarsetu-map" style={{ height }}>
        <Map
          defaultCenter={center}
          defaultZoom={zoom}
          mapId={mapId}
          gestureHandling="greedy"
          clickableIcons={false}
          onClick={handleMapClick}
        >
          {validComplaints.map((complaint) => (
            <MarkerWithInfo
              key={complaint.id}
              complaint={complaint}
              onSelect={onComplaintSelect}
              detailUrlPrefix={detailUrlPrefix}
              showNavigationButton={showNavigationButton}
            />
          ))}
          {selectedPosition && <SelectedLocationMarker position={selectedPosition} />}
        </Map>

        {enableLocationPicker && (
          <div className="nagarsetu-map-hint">
            📍 Click anywhere on the map to set the exact issue location.
          </div>
        )}
      </div>
    </APIProvider>
  );
}
