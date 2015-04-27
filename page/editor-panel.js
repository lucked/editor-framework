var _idToPanelInfo = {};
var _url2link = {};

_getPanels = function ( panelEL ) {
    var panels = [];

    var panelDOM = Polymer.dom(panelEL);
    for ( var i = 0; i < panelDOM.children.length; ++i ) {
        var childEL = panelDOM.children[i];
        var id = childEL.getAttribute('id');
        panels.push(id);
    }

    return panels;
};

_getDocks = function ( dockEL ) {
    var docks = [];

    var dockDOM = Polymer.dom(dockEL);
    for ( var i = 0; i < dockDOM.children.length; ++i ) {
        var childEL = dockDOM.children[i];

        if ( !childEL['ui-dockable'] )
            continue;

        var rect = childEL.getBoundingClientRect();
        var info = {
            'row': childEL.row,
            'width': rect.width,
            'height': rect.height,
        };

        if ( childEL instanceof EditorUI.Panel ) {
            info.type = 'panel';
            info.panels = _getPanels(childEL);
        }
        else {
            info.type = 'dock';
            info.docks = _getDocks(childEL);
        }

        docks.push(info);
    }

    return docks;
};

function _registerIpc ( panelID, viewEL, ipcListener, ipcName ) {
    var fn = viewEL[ipcName];
    if ( !fn || typeof fn !== 'function' ) {
        if ( ipcName !== 'panel:open') {
            Editor.warn('Failed to register ipc message %s in panel %s, Can not find implementation', ipcName, panelID );
        }
        return;
    }

    ipcListener.on( ipcName, function () {
        var fn = viewEL[ipcName];
        if ( !fn || typeof fn !== 'function' ) {
            Editor.warn('Failed to respond ipc message %s in panel %s, Can not find implementation', ipcName, panelID );
            return;
        }
        fn.apply( viewEL, arguments );
    } );
}

function _registerProfile ( panelID, type, profile ) {
    profile.save = function () {
        Editor.sendToCore('panel:save-profile', panelID, type, profile);
    };
}

var Panel = {};

Panel.import = function ( url, cb ) {
    var link = _url2link[url];
    if ( link ) {
        link.remove();
        delete _url2link[url];
    }

    link = document.createElement('link');
    link.rel = 'import';
    link.href = url;
    // link.onload = cb;
    link.onerror = function(e) {
        Editor.error('Failed to import %s', link.href);
    };

    document.head.appendChild(link);
    _url2link[url] = link;

    //
    HTMLImports.whenReady( function () {
        cb();
    });
};

Panel.load = function ( url, panelID, panelInfo, cb ) {
    Panel.import(url, function () {
        var ctorPath = panelID.split('.');

        var i;
        var ctorNotFound = false;
        var viewCtor = window;
        for ( i = 0; i < ctorPath.length; ++i ) {
            viewCtor = viewCtor[ctorPath[i]];
            if ( !viewCtor ) {
                ctorNotFound = true;
                break;
            }
        }
        if ( viewCtor === window ) {
            ctorNotFound = true;
        }

        if ( ctorNotFound ) {
            Editor.error('Panel import faield. Can not find constructor %s', panelInfo.ctor );
            return;
        }

        var viewEL = new viewCtor();
        viewEL.setAttribute('id', panelID);
        viewEL.setAttribute('name', panelInfo.title);
        viewEL.classList.add('fit');

        // set size attribute
        if ( panelInfo.width )
            viewEL.setAttribute( 'width', panelInfo.width );

        if ( panelInfo.height )
            viewEL.setAttribute( 'height', panelInfo.height );

        if ( panelInfo['min-width'] )
            viewEL.setAttribute( 'min-width', panelInfo['min-width'] );

        if ( panelInfo['min-height'] )
            viewEL.setAttribute( 'min-height', panelInfo['min-height'] );

        if ( panelInfo['max-width'] )
            viewEL.setAttribute( 'max-width', panelInfo['max-width'] );

        if ( panelInfo['max-height'] )
            viewEL.setAttribute( 'max-height', panelInfo['max-height'] );

        // register ipc events
        var ipcListener = new Editor.IpcListener();

        // always have panel:open message
        if ( panelInfo.messages.indexOf('panel:open') === -1 ) {
            panelInfo.messages.push('panel:open');
        }

        for ( i = 0; i < panelInfo.messages.length; ++i ) {
            _registerIpc( panelID, viewEL, ipcListener, panelInfo.messages[i] );
        }

        //
        _idToPanelInfo[panelID] = {
            element: viewEL,
            messages: panelInfo.messages,
            ipcListener: ipcListener
        };
        Editor.sendToCore('panel:dock', panelID, Editor.requireIpcEvent);

        viewEL.profiles = panelInfo.profiles;
        for ( var type in panelInfo.profiles ) {
            _registerProfile ( panelID, type, panelInfo.profiles[type] );
        }

        cb ( null, viewEL );
    });
};

Panel.open = function ( panelID, argv ) {
    Editor.sendToCore('panel:open', panelID, argv);
};

Panel.close = function ( panelID ) {
    // remove panel element from tab
    var viewEL = Editor.Panel.find(panelID);
    if ( viewEL ) {
        var panelEL = Polymer.dom(viewEL).parentNode;
        var currentTabEL = panelEL.$.tabs.find(viewEL);
        panelEL.close(currentTabEL);
    }

    // remove panelInfo
    var panelInfo = _idToPanelInfo[panelID];
    if ( panelInfo) {
        panelInfo.ipcListener.clear();
        delete _idToPanelInfo[panelID];

        // send undock message
        Editor.sendToCore('panel:undock', panelID, Editor.requireIpcEvent);
    }
};

Panel.closeAll = function () {
    for ( var id in _idToPanelInfo ) {
        Panel.close(id);
    }
};

Panel.dispatch = function ( panelID, ipcName ) {
    var panelInfo = _idToPanelInfo[panelID];
    if ( !panelInfo ) {
        Editor.warn( 'Failed to receive ipc %s, can not find panel %s', ipcName, panelID);
        return;
    }

    // messages
    var idx = panelInfo.messages.indexOf(ipcName);
    if ( idx === -1 ) {
        Editor.warn('Can not find ipc message %s register in panel %s', ipcName, panelID );
        return;
    }

    var fn = panelInfo.element[ipcName];
    if ( !fn || typeof fn !== 'function' ) {
        if ( ipcName !== 'panel:open') {
            Editor.warn('Failed to respond ipc message %s in panel %s, Can not find implementation', ipcName, panelID );
        }
        return;
    }
    var args = [].slice.call( arguments, 2 );
    fn.apply( panelInfo.element, args );
};

Panel.getLayout = function () {
    var root = EditorUI.DockUtils.root;
    if ( !root )
        return null;

    if ( root['ui-dockable'] ) {
        return {
            'type': 'dock',
            'row': root.row,
            'no-collapse': true,
            'docks': _getDocks(root),
        };
    }
    else {
        var id = root.getAttribute('id');
        var rect = root.getBoundingClientRect();

        return {
            'type': 'standalone',
            'panel': id,
            'width': rect.width,
            'height': rect.height,
        };
    }
};

Panel.find = function ( panelID ) {
    var panelInfo = _idToPanelInfo[panelID];
    if ( !panelInfo ) {
        return null;
    }
    return panelInfo.element;
};

// position: top, bottom, left, right, top-left, top-right, bottom-left, bottom-right
Panel.dockTo = function ( position, panelEL ) {
    var root = EditorUI.DockUtils.root;
    if ( !root ) {
        return null;
    }

    if ( !root['ui-dockable'] ) {
        return null;
    }

    // TODO
};

// ==========================
// Ipc events
// ==========================

var Ipc = require('ipc');

Ipc.on('panel:close', function ( panelID ) {
    Editor.Panel.close(panelID);
});

module.exports = Panel;
