"""This file and its contents are licensed under the Apache License 2.0. Please see the included NOTICE for copyright information and LICENSE for a copy of the license."""

import os

from core.permissions import ViewClassPermission, all_permissions
from django.conf import settings
from django.core.exceptions import SuspiciousFileOperation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils._os import safe_join
from django.utils.decorators import method_decorator
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from io_storages.api import (
    ExportStorageDetailAPI,
    ExportStorageFormLayoutAPI,
    ExportStorageListAPI,
    ExportStorageSyncAPI,
    ExportStorageValidateAPI,
    ImportStorageDetailAPI,
    ImportStorageFormLayoutAPI,
    ImportStorageListAPI,
    ImportStorageSyncAPI,
    ImportStorageValidateAPI,
)
from io_storages.localfiles.models import LocalFilesExportStorage, LocalFilesImportStorage
from io_storages.localfiles.serializers import LocalFilesExportStorageSerializer, LocalFilesImportStorageSerializer
from projects.models import Project
from rest_framework import generics
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from .openapi_schema import (
    _local_files_export_storage_schema,
    _local_files_export_storage_schema_with_id,
    _local_files_import_storage_schema,
    _local_files_import_storage_schema_with_id,
)


@method_decorator(
    name='get',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Get all import storage',
        description='Get a list of all local file import storage connections.',
        parameters=[
            OpenApiParameter(
                name='project',
                type=OpenApiTypes.INT,
                location='query',
                description='Project ID',
                required=True,
            ),
        ],
        request=None,
        extensions={
            'x-fern-sdk-group-name': ['import_storage', 'local'],
            'x-fern-sdk-method-name': 'list',
            'x-fern-audiences': ['public'],
        },
    ),
)
@method_decorator(
    name='post',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Create import storage',
        description='Create a new local file import storage connection.',
        request={
            'application/json': _local_files_import_storage_schema,
        },
        extensions={
            'x-fern-sdk-group-name': ['import_storage', 'local'],
            'x-fern-sdk-method-name': 'create',
            'x-fern-audiences': ['public'],
        },
    ),
)
class LocalFilesImportStorageListAPI(ImportStorageListAPI):
    queryset = LocalFilesImportStorage.objects.all()
    serializer_class = LocalFilesImportStorageSerializer


@method_decorator(
    name='get',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Get import storage',
        description='Get a specific local file import storage connection.',
        request=None,
        extensions={
            'x-fern-sdk-group-name': ['import_storage', 'local'],
            'x-fern-sdk-method-name': 'get',
            'x-fern-audiences': ['public'],
        },
    ),
)
@method_decorator(
    name='patch',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Update import storage',
        description='Update a specific local file import storage connection.',
        request={
            'application/json': _local_files_import_storage_schema,
        },
        extensions={
            'x-fern-sdk-group-name': ['import_storage', 'local'],
            'x-fern-sdk-method-name': 'update',
            'x-fern-audiences': ['public'],
        },
    ),
)
@method_decorator(
    name='delete',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Delete import storage',
        description='Delete a specific local file import storage connection.',
        request=None,
        extensions={
            'x-fern-sdk-group-name': ['import_storage', 'local'],
            'x-fern-sdk-method-name': 'delete',
            'x-fern-audiences': ['public'],
        },
    ),
)
class LocalFilesImportStorageDetailAPI(ImportStorageDetailAPI):
    queryset = LocalFilesImportStorage.objects.all()
    serializer_class = LocalFilesImportStorageSerializer


@method_decorator(
    name='post',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Sync import storage',
        description='Sync tasks from a local file import storage connection.',
        parameters=[
            OpenApiParameter(
                name='id',
                type=OpenApiTypes.INT,
                location='path',
                description='Storage ID',
            ),
        ],
        request=None,
        extensions={
            'x-fern-sdk-group-name': ['import_storage', 'local'],
            'x-fern-sdk-method-name': 'sync',
            'x-fern-audiences': ['public'],
        },
    ),
)
class LocalFilesImportStorageSyncAPI(ImportStorageSyncAPI):
    serializer_class = LocalFilesImportStorageSerializer


@method_decorator(
    name='post',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Sync export storage',
        description='Sync tasks from a local file export storage connection.',
        request=None,
        extensions={
            'x-fern-sdk-group-name': ['export_storage', 'local'],
            'x-fern-sdk-method-name': 'sync',
            'x-fern-audiences': ['public'],
        },
    ),
)
class LocalFilesExportStorageSyncAPI(ExportStorageSyncAPI):
    serializer_class = LocalFilesExportStorageSerializer


@method_decorator(
    name='post',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Validate import storage',
        description='Validate a specific local file import storage connection.',
        request={
            'application/json': _local_files_import_storage_schema_with_id,
        },
        responses={200: OpenApiResponse(description='Validation successful')},
        extensions={
            'x-fern-sdk-group-name': ['import_storage', 'local'],
            'x-fern-sdk-method-name': 'validate',
            'x-fern-audiences': ['public'],
        },
    ),
)
class LocalFilesImportStorageValidateAPI(ImportStorageValidateAPI):
    serializer_class = LocalFilesImportStorageSerializer


@method_decorator(
    name='post',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Validate export storage',
        description='Validate a specific local file export storage connection.',
        request={
            'application/json': _local_files_export_storage_schema_with_id,
        },
        responses={200: OpenApiResponse(description='Validation successful')},
        extensions={
            'x-fern-sdk-group-name': ['export_storage', 'local'],
            'x-fern-sdk-method-name': 'validate',
            'x-fern-audiences': ['public'],
        },
    ),
)
class LocalFilesExportStorageValidateAPI(ExportStorageValidateAPI):
    serializer_class = LocalFilesExportStorageSerializer


@method_decorator(
    name='get',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Get all export storage',
        description='Get a list of all local file export storage connections.',
        parameters=[
            OpenApiParameter(
                name='project',
                type=OpenApiTypes.INT,
                location='query',
                description='Project ID',
                required=True,
            ),
        ],
        extensions={
            'x-fern-sdk-group-name': ['export_storage', 'local'],
            'x-fern-sdk-method-name': 'list',
            'x-fern-audiences': ['public'],
        },
    ),
)
@method_decorator(
    name='post',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Create export storage',
        description='Create a new local file export storage connection to store annotations.',
        request={
            'application/json': _local_files_export_storage_schema,
        },
        extensions={
            'x-fern-sdk-group-name': ['export_storage', 'local'],
            'x-fern-sdk-method-name': 'create',
            'x-fern-audiences': ['public'],
        },
    ),
)
class LocalFilesExportStorageListAPI(ExportStorageListAPI):
    queryset = LocalFilesExportStorage.objects.all()
    serializer_class = LocalFilesExportStorageSerializer


@method_decorator(
    name='get',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Get export storage',
        description='Get a specific local file export storage connection.',
        request=None,
        extensions={
            'x-fern-sdk-group-name': ['export_storage', 'local'],
            'x-fern-sdk-method-name': 'get',
            'x-fern-audiences': ['public'],
        },
    ),
)
@method_decorator(
    name='patch',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Update export storage',
        description='Update a specific local file export storage connection.',
        request={
            'application/json': _local_files_export_storage_schema,
        },
        extensions={
            'x-fern-sdk-group-name': ['export_storage', 'local'],
            'x-fern-sdk-method-name': 'update',
            'x-fern-audiences': ['public'],
        },
    ),
)
@method_decorator(
    name='delete',
    decorator=extend_schema(
        tags=['Storage: Local'],
        summary='Delete export storage',
        description='Delete a specific local file export storage connection.',
        request=None,
        extensions={
            'x-fern-sdk-group-name': ['export_storage', 'local'],
            'x-fern-sdk-method-name': 'delete',
            'x-fern-audiences': ['public'],
        },
    ),
)
class LocalFilesExportStorageDetailAPI(ExportStorageDetailAPI):
    queryset = LocalFilesExportStorage.objects.all()
    serializer_class = LocalFilesExportStorageSerializer


class LocalFilesImportStorageFormLayoutAPI(ImportStorageFormLayoutAPI):
    pass


class LocalFilesExportStorageFormLayoutAPI(ExportStorageFormLayoutAPI):
    pass


def _folder_picker_root():
    """Resolve+validate the fixed root the folder picker is allowed to browse under."""
    try:
        return safe_join(settings.LOCAL_FILES_DOCUMENT_ROOT, settings.LOCAL_FILES_FOLDER_PICKER_SUBDIR)
    except SuspiciousFileOperation:
        raise ValidationError('Invalid LOCAL_FILES_FOLDER_PICKER_SUBDIR configuration')


class LocalFilesBrowseFoldersAPI(generics.GenericAPIView):
    """List top-level subfolders under LOCAL_FILES_FOLDER_PICKER_SUBDIR (e.g. per-labeler
    working folders) so the frontend folder picker can offer them."""

    permission_required = ViewClassPermission(GET=all_permissions.storages_view)
    queryset = LocalFilesImportStorage.objects.all()

    def get(self, request, *args, **kwargs):
        project_pk = request.query_params.get('project')
        if not project_pk:
            raise ValidationError('query parameter "project" is required')
        project = generics.get_object_or_404(Project, pk=project_pk)
        self.check_object_permissions(request, project)

        browse_root = _folder_picker_root()
        if not os.path.isdir(browse_root):
            return Response({'folders': []})

        folders = sorted(entry.name for entry in os.scandir(browse_root) if entry.is_dir())
        return Response({'folders': folders})


class LocalFilesSelectFolderAPI(generics.GenericAPIView):
    """Point a project's local-files import storage at a chosen subfolder, creating the
    storage first if the project doesn't have one yet (e.g. a fresh Create Project draft).
    Syncs immediately unless the caller passes sync:false -- the Create Project wizard defers
    the sync to final publish so an abandoned draft doesn't leave synced tasks behind."""

    permission_required = ViewClassPermission(POST=all_permissions.storages_change)
    queryset = LocalFilesImportStorage.objects.all()
    serializer_class = LocalFilesImportStorageSerializer

    def post(self, request, *args, **kwargs):
        project_pk = request.data.get('project')
        folder = request.data.get('folder')
        should_sync = request.data.get('sync', True)
        if not project_pk:
            raise ValidationError('"project" is required')
        if not folder:
            raise ValidationError('"folder" is required')

        project = generics.get_object_or_404(Project, pk=project_pk)
        self.check_object_permissions(request, project)

        browse_root = _folder_picker_root()
        try:
            target_path = safe_join(browse_root, folder)
        except SuspiciousFileOperation:
            raise ValidationError(f'Invalid folder "{folder}"')

        if not os.path.isdir(target_path):
            raise NotFound(f'Folder "{folder}" does not exist')

        storage = LocalFilesImportStorage.objects.filter(project_id=project.id).first()
        if storage is None:
            storage = LocalFilesImportStorage(
                project=project,
                title='grocery-images',
                regex_filter=r'.*\.(jpg|jpeg|png|webp)$',
                use_blob_urls=True,
            )

        storage.path = target_path
        storage.recursive_scan = True
        try:
            storage.validate_connection()
        except DjangoValidationError as e:
            raise ValidationError(str(e))
        storage.save()

        if should_sync:
            storage.sync()
            storage.refresh_from_db()

        return Response(
            {
                'id': storage.id,
                'path': storage.path,
                'status': storage.status,
                'last_sync_count': storage.last_sync_count,
            }
        )
